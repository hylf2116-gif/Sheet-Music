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


def measure_boxes(multi_staffs, voices, to_input, gray):
    """One box per bar: each system's height, split at its bar lines.
    Bar positions come from the recognized bar lines (approximate) snapped to the real lines."""
    height, width = gray.shape
    # per system: bar count and the approximate x of each bar line (input image pixels)
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

    boxes, staff_h = [], []
    for row, (n, bar_xs) in zip(multi_staffs, systems):
        if n <= 0:
            continue
        top, bottom = row.staffs[0], row.staffs[-1]
        x0, y0 = to_input((float(top.min_x), float(top.min_y)))
        x1, y1 = to_input((float(top.max_x), float(bottom.max_y)))
        _, sy1 = to_input((0.0, float(top.max_y)))
        staff_h.append((sy1 - y0) / height)
        unit = (sy1 - y0) / 4
        # the bar lines between bars: the first n-1 (a line closing the system is its right edge)
        inner = [x for x in bar_xs[:n - 1] if x is not None]
        inner = sorted(snap_to_line(gray, min(max(x, x0 + unit), x1 - unit), y0, sy1, 4 * unit) for x in inner)
        edges = [x0] + inner + [x1]
        if len(edges) - 1 != n or any(b - a < unit for a, b in zip(edges, edges[1:])):
            edges = [x0 + (x1 - x0) * i / n for i in range(n + 1)]   # fall back: even split, right count
        for i in range(n):
            boxes.append({"x": edges[i] / width, "y": y0 / height,
                          "w": (edges[i + 1] - edges[i]) / width, "h": (y1 - y0) / height})
    staff_height = sorted(staff_h)[len(staff_h) // 2] if staff_h else None
    return boxes, staff_height


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
    try:
        debug.clean_debug_files_from_previous_runs()
    except Exception:
        pass
    return xml, boxes, staff_height


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
            xml, boxes, staff_height = recognize_page(png, np.asarray(img))
            say({"page": k, "xml": xml, "measures": boxes, "staffHeight": staff_height})
        except Exception as e:  # one bad page must not stop the rest
            say({"page": k, "error": str(e) or e.__class__.__name__, "trace": traceback.format_exc()[-800:]})
    say({"done": True})


if __name__ == "__main__":
    main()
