"""
Recognizes a PDF score with homr (an AI music reader) and prints one JSON line per page:
  {"page": k, "xml": "<score-partwise ...>", "measures": [{"x","y","w","h"}...], "staffHeight": h}
Boxes are 0..1 of the page, one per bar, in reading order, and their count always matches the
bars in that page's MusicXML (so highlighting, "click to play" and the playback line line up).
At the end it prints {"done": true}. Errors on a page print {"page": k, "error": "..."}.

Usage: python homr_runner.py <file.pdf> <work dir> [first page] [last page]   (pages are 1-based)
Runs in its own Python (see INSTALL notes in DEPLOY.md); homr downloads its models on first use.
"""
import json
import os
import sys
import traceback
import xml.etree.ElementTree as ET

import numpy as np
import pypdfium2 as pdfium

from homr import main as hm
from homr.music_xml_generator import XmlGeneratorArguments, generate_xml
from homr.staff_parsing import parse_staffs
from homr.system_repair import repair_systems
from homr.transformer.configs import Config

DPI = 300


def say(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def config():
    return hm.ProcessingConfig(
        enable_debug=False, enable_cache=False, write_staff_positions=False, read_staff_positions=False,
        selected_staff=-1, transformer_use_gpu=False,
        # Apple's CoreML (Mac) / CUDA speed up the first stage; HOMR_GPU=0 turns it off
        segnet_use_gpu=os.environ.get("HOMR_GPU", "1") != "0" and (hm.coreml_available() or hm.cuda_available()),
        coreml_encoder=False, title_detection=False,
    )


BAR_SYMBOLS = ("barline", "repeatEnd", "repeatStart", "repeatEndStart", "bolddoublebarline", "doublebarline")


def is_bar(rhythm):
    return rhythm.startswith("barline") or rhythm in BAR_SYMBOLS


def snap_to_line(gray, x, y0, y1, reach):
    """Move x to the nearest vertical line that crosses the whole staff (a real bar line)."""
    h, w = gray.shape
    lo, hi = max(0, int(x - reach)), min(w - 1, int(x + reach))
    ys0, ys1 = max(0, int(y0)), min(h, int(y1))
    if hi <= lo or ys1 - ys0 < 5:
        return x
    band = gray[ys0:ys1, lo:hi + 1] < 128              # dark pixels
    cover = band.mean(axis=0)                         # how much of the staff height each column covers
    best = int(cover.argmax())
    if cover[best] < 0.85:
        return x
    # among good columns, take the one nearest the estimate
    good = [i for i, c in enumerate(cover) if c >= 0.85]
    best = min(good, key=lambda i: abs(lo + i - x))
    return float(lo + best)


def find_bar_lines(gray, x0, x1, ytop, ybot, unit):
    """Vertical lines that cross a staff band from top to bottom: bar lines (and some stems).
    Only used as candidates: the boxes take the ones nearest to where the AI put its bar lines."""
    h, w = gray.shape
    lo, hi = max(0, int(x0 + 1.5 * unit)), min(w, int(x1 - 0.8 * unit))
    ya, yb = max(0, int(ytop + 1)), min(h, int(ybot - 1))
    if hi - lo < 10 or yb - ya < 5:
        return []
    good = (gray[ya:yb, lo:hi] < 140).mean(axis=0) >= 0.86
    runs, i = [], 0
    while i < len(good):
        if good[i]:
            j = i
            while j + 1 < len(good) and good[j + 1]:
                j += 1
            runs.append((lo + i, lo + j))
            i = j + 1
        else:
            i += 1
    runs = [r for r in runs if r[1] - r[0] <= max(3, 0.9 * unit)]
    xs = []
    for a_, b_ in runs:
        c = (a_ + b_) / 2
        if xs and c - xs[-1] < 1.2 * unit:
            xs[-1] = max(xs[-1], c)
        else:
            xs.append(c)
    return [x for x in xs if x < x1 - 1.0 * unit]


def choose(cands, est):
    """Pick len(est) of the candidate x positions, in order, closest to the estimates (DP)."""
    n, m = len(est), len(cands)
    INF = float("inf")
    dp = [[INF] * (m + 1) for _ in range(n + 1)]
    take = [[False] * (m + 1) for _ in range(n + 1)]
    for j in range(m + 1):
        dp[0][j] = 0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            skip = dp[i][j - 1]
            use = dp[i - 1][j - 1] + abs(cands[j - 1] - est[i - 1])
            if use <= skip:
                dp[i][j], take[i][j] = use, True
            else:
                dp[i][j] = skip
    out, i, j = [], n, m
    while i > 0 and j > 0:
        if take[i][j]:
            out.append(cands[j - 1]); i -= 1; j -= 1
        else:
            j -= 1
    return out[::-1]


def measure_boxes(multi_staffs, voices, to_input, gray):
    """One box per bar. The AI says how many bars each system has; the bar lines printed on
    the page say where they are (found in the image). AI positions only break ties."""
    height, width = gray.shape
    systems, bars, xs, has_notes = [], 0, [], False
    for s in (voices[0] if voices else []):
        if s.rhythm == "newline":
            systems.append((bars + (1 if has_notes else 0), xs))
            bars, xs, has_notes = 0, [], False
        elif is_bar(s.rhythm):
            if has_notes:
                bars += 1
                xs.append(s.image_coordinates[0] if s.image_coordinates else None)
            has_notes = False
        else:
            has_notes = True
    if bars or has_notes:
        systems.append((bars + (1 if has_notes else 0), xs))

    boxes, staff_h, checks = [], [], []
    for row, (n, bar_xs) in zip(multi_staffs, systems):
        if n <= 0:
            continue
        top, bottom = row.staffs[0], row.staffs[-1]
        x0, y0 = to_input((float(top.min_x), float(top.min_y)))
        x1, y1 = to_input((float(top.max_x), float(bottom.max_y)))
        _, sy1 = to_input((0.0, float(top.max_y)))
        staff_h.append((sy1 - y0) / height)
        unit = (sy1 - y0) / 4
        # where the AI thinks the bar lines are (or an even split where it doesn't say)
        est = [x for x in bar_xs[:n - 1]]
        est = [e if e is not None else x0 + (x1 - x0) * (k + 1) / n for k, e in enumerate(est)]
        while len(est) < n - 1:
            est.append(x0 + (x1 - x0) * (len(est) + 1) / n)
        # vertical lines on the page (bar lines, plus some stems): across the whole system, and
        # if that finds too few (staves not joined), the top staff and the bottom staff as well
        lines = find_bar_lines(gray, x0, x1, y0, y1, unit)
        if len(lines) < n - 1 and len(row.staffs) > 1:
            _, by0 = to_input((0.0, float(bottom.min_y)))
            more = find_bar_lines(gray, x0, x1, y0, sy1, unit) + find_bar_lines(gray, x0, x1, by0, y1, unit)
            lines = sorted(set(lines) | set(more))
        if len(lines) >= n - 1:
            inner = choose(lines, sorted(est))
            checks.append(1.0)
        else:
            # not enough printed lines found: use the ones found, estimates for the rest
            extra = [e for e in sorted(est) if all(abs(e - l) > 2 * unit for l in lines)]
            inner = sorted(lines + extra)
            inner = choose(inner, sorted(est)) if len(inner) >= n - 1 else inner
            checks.append(len(lines) / max(1, n - 1))
        edges = [x0] + sorted(inner) + [x1]
        if len(edges) != n + 1 or any(b - a < unit for a, b in zip(edges, edges[1:])):
            edges = [x0 + (x1 - x0) * i / n for i in range(n + 1)]
        for i in range(n):
            boxes.append({"x": edges[i] / width, "y": y0 / height,
                          "w": (edges[i + 1] - edges[i]) / width, "h": (y1 - y0) / height})
    staff_height = sorted(staff_h)[len(staff_h) // 2] if staff_h else None
    sys.stderr.write(f"bar lines found on the page for {sum(1 for c in checks if c >= 1)}/{len(checks)} systems\n")
    return boxes, staff_height


_ocr = None


def part_labels(multi_staffs, to_input, gray, n_parts):
    """Instrument names printed left of the first full line of music (e.g. "Bassoon I",
    "Violoncello", "Basso continuo"), one per part, top to bottom. Empty strings where none."""
    global _ocr
    if not multi_staffs or n_parts <= 0:
        return []
    row = max(multi_staffs[:3], key=lambda r: len(r.staffs))   # first systems usually carry full names
    staffs = row.staffs
    # parts take consecutive staves; when there are fewer parts than staves, the lowest part
    # (piano / continuo with two staves) takes the extra ones
    spans, k = [], 0
    for i in range(n_parts):
        take = 1 + (len(staffs) - n_parts if i == n_parts - 1 else 0)
        group = staffs[k:k + max(1, take)]
        k += max(1, take)
        if not group:
            break
        _, ya = to_input((0.0, float(group[0].min_y)))
        _, yb = to_input((0.0, float(group[-1].max_y)))
        spans.append((ya, yb))
    left, _ = to_input((float(min(s.min_x for s in staffs)), 0.0))
    if left < 40 or not spans:
        return [""] * n_parts
    top = max(0, int(spans[0][0] - (spans[0][1] - spans[0][0]))); bot = min(gray.shape[0], int(spans[-1][1] + 20))
    crop = gray[top:bot, 0:int(left - 4)]
    try:
        if _ocr is None:
            from rapidocr import RapidOCR
            _ocr = RapidOCR()
        res = _ocr(np.stack([crop] * 3, axis=-1))
    except Exception as e:  # text reading is a bonus: never let it break recognition
        sys.stderr.write(f"part names: OCR failed ({e})\n")
        return [""] * n_parts
    if not res or res.txts is None:
        return [""] * n_parts
    names = [[] for _ in spans]
    for box, txt in zip(res.boxes, res.txts):
        cy = top + (box[0][1] + box[2][1]) / 2
        best = min(range(len(spans)), key=lambda i: 0 if spans[i][0] - 15 <= cy <= spans[i][1] + 15 else min(abs(cy - spans[i][0]), abs(cy - spans[i][1])))
        names[best].append((cy, txt.strip()))
    return [" ".join(t for _, t in sorted(n)).strip() for n in names] + [""] * (n_parts - len(spans))


def fit_box_count(boxes, want):
    """Split the widest boxes / merge the narrowest neighbours until there are `want` boxes."""
    boxes = [dict(b) for b in boxes]
    if not boxes or want <= 0:
        return boxes
    while len(boxes) < want:
        i = max(range(len(boxes)), key=lambda k: boxes[k]["w"])
        b = boxes[i]
        half = dict(b, w=b["w"] / 2)
        boxes[i:i + 1] = [half, dict(b, x=b["x"] + b["w"] / 2, w=b["w"] / 2)]
    while len(boxes) > want:
        # merge the narrowest box into its neighbour on the same line
        i = min(range(len(boxes)), key=lambda k: boxes[k]["w"])
        j = i - 1 if i > 0 and abs(boxes[i - 1]["y"] - boxes[i]["y"]) < 1e-6 else i + 1
        if j >= len(boxes):
            j = i - 1
        a, b = sorted((i, j))
        x0 = min(boxes[a]["x"], boxes[b]["x"])
        x1 = max(boxes[a]["x"] + boxes[a]["w"], boxes[b]["x"] + boxes[b]["w"])
        boxes[a:b + 1] = [dict(boxes[a], x=x0, w=x1 - x0)]
    return boxes


def recognize_page(png_path, gray):
    cfg = config()
    multi_staffs, image, debug, _title, _n, to_input = hm.detect_staffs_in_image(png_path, cfg)
    multi_staffs = repair_systems(debug, multi_staffs)
    tcfg = Config()
    tcfg.use_gpu_inference = False
    voices = parse_staffs(debug, multi_staffs, image, config=tcfg, page_to_input_image=to_input)
    boxes, staff_height = measure_boxes(multi_staffs, voices, to_input, gray)
    root = generate_xml(XmlGeneratorArguments(), voices, "")
    xml = ET.tostring(root, encoding="unicode")
    # The boxes must match the bars in the MusicXML one to one (highlighting depends on it).
    part = root.find("part")
    want = len(part.findall("measure")) if part is not None else len(boxes)
    boxes = fit_box_count(boxes, want)
    labels = part_labels(multi_staffs, to_input, gray, len(root.findall("part")))
    try:
        debug.clean_debug_files_from_previous_runs()
    except Exception:
        pass
    return xml, boxes, staff_height, labels


def main():
    pdf_path, work = sys.argv[1], sys.argv[2]
    os.makedirs(work, exist_ok=True)
    pdf = pdfium.PdfDocument(pdf_path)
    first = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    last = int(sys.argv[4]) if len(sys.argv) > 4 else len(pdf)
    for k in range(first, min(last, len(pdf)) + 1):
        try:
            img = pdf[k - 1].render(scale=DPI / 72).to_pil().convert("L")
            png = os.path.join(work, f"page{k}.png")
            img.save(png)
            xml, boxes, staff_height, labels = recognize_page(png, np.asarray(img))
            say({"page": k, "xml": xml, "measures": boxes, "staffHeight": staff_height, "labels": labels})
        except Exception as e:  # one bad page must not stop the rest
            say({"page": k, "error": str(e) or e.__class__.__name__, "trace": traceback.format_exc()[-800:]})
    say({"done": True})


if __name__ == "__main__":
    main()
