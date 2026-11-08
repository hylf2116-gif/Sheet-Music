#!/usr/bin/env bash
# run_omr.sh  <PDF_PATH>  [OUTPUT_DIR]
#
# Runs Audiveris on a PDF, produces:
#   <output>/<stem>.mxl          — compressed MusicXML
#   <output>/<stem>.omr          — Audiveris book (contains bounding boxes)
#   <output>/<stem>_measures.json — extracted measure bounding boxes per page
#
# Requirements:
#   - Java 17+     (export JAVA_HOME=/path/to/jdk)
#   - Audiveris    (export AUDIVERIS_JAR=/path/to/audiveris-cli.jar)
#
# If neither env var is set, the script tries common install locations.

set -euo pipefail

PDF="${1:-}"
OUTPUT_DIR="${2:-./omr-output}"

if [[ -z "$PDF" ]]; then
  echo "Usage: $0 <pdf_path> [output_dir]" >&2
  exit 1
fi

if [[ ! -f "$PDF" ]]; then
  echo "ERROR: File not found: $PDF" >&2
  exit 1
fi

PDF="$(realpath "$PDF")"
STEM="$(basename "$PDF" .pdf)"
mkdir -p "$OUTPUT_DIR"

# ── Locate Java ───────────────────────────────────────────────────────────────
if [[ -z "${JAVA_HOME:-}" ]]; then
  for candidate in \
    "$(brew --prefix openjdk 2>/dev/null || true)/bin/java" \
    "$HOME/.sdkman/candidates/java/current/bin/java" \
    "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java" \
    "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin/java" \
    "/usr/lib/jvm/java-21-openjdk-amd64/bin/java"; do
    if [[ -x "$candidate" ]]; then
      JAVA_BIN="$candidate"
      break
    fi
  done
  JAVA_BIN="${JAVA_BIN:-java}"
else
  JAVA_BIN="$JAVA_HOME/bin/java"
fi

if ! "$JAVA_BIN" -version >/dev/null 2>&1; then
  echo "ERROR: Java not found. Install Java 17+ first (see INSTALL.md)." >&2
  exit 2
fi

JAVA_VER=$("$JAVA_BIN" -version 2>&1 | awk -F'"' '/version/{print $2}' | cut -d. -f1)
if [[ "${JAVA_VER:-0}" -lt 17 ]]; then
  echo "ERROR: Java 17+ required; found version ${JAVA_VER}." >&2
  exit 2
fi

echo "✓ Java: $("$JAVA_BIN" -version 2>&1 | head -1)"

# ── Locate Audiveris JAR ──────────────────────────────────────────────────────
if [[ -z "${AUDIVERIS_JAR:-}" ]]; then
  for candidate in \
    "$(dirname "$0")/audiveris-cli.jar" \
    "$HOME/audiveris/build/audiveris-cli.jar" \
    "/opt/audiveris/audiveris-cli.jar" \
    "/usr/local/lib/audiveris/audiveris-cli.jar"; do
    if [[ -f "$candidate" ]]; then
      AUDIVERIS_JAR="$candidate"
      break
    fi
  done
fi

if [[ -z "${AUDIVERIS_JAR:-}" ]] || [[ ! -f "${AUDIVERIS_JAR}" ]]; then
  echo "ERROR: audiveris-cli.jar not found. Set AUDIVERIS_JAR= or see INSTALL.md." >&2
  exit 2
fi

echo "✓ Audiveris: $AUDIVERIS_JAR"

# ── Run Audiveris in batch mode ───────────────────────────────────────────────
echo ""
echo "Processing: $PDF"
echo "Output dir: $OUTPUT_DIR"
echo ""

"$JAVA_BIN" -Xmx2g -jar "$AUDIVERIS_JAR" \
  -batch \
  -export \
  -output "$OUTPUT_DIR" \
  "$PDF"

MXL_OUT="$OUTPUT_DIR/$STEM.mxl"
OMR_OUT="$OUTPUT_DIR/$STEM.omr"

[[ -f "$MXL_OUT" ]] && echo "✓ MusicXML written: $MXL_OUT" || echo "⚠ MXL not found at expected path"
[[ -f "$OMR_OUT" ]] && echo "✓ OMR book written: $OMR_OUT"  || echo "⚠ OMR book not found"

# ── Extract measure bounding boxes from .omr ──────────────────────────────────
# The .omr file is a ZIP; inside is a Sheet#N.xml per page with glyph data.
JSON_OUT="$OUTPUT_DIR/${STEM}_measures.json"

python3 - <<PYEOF
import zipfile, xml.etree.ElementTree as ET, json, os, sys

omr_path = "$OMR_OUT"
json_path = "$JSON_OUT"

if not os.path.exists(omr_path):
    print("⚠ Skipping bounding box extraction — .omr not found")
    sys.exit(0)

results = []

with zipfile.ZipFile(omr_path, 'r') as z:
    sheet_files = sorted(f for f in z.namelist() if f.startswith('Sheet#') and f.endswith('.xml'))
    print(f"  Pages in .omr: {len(sheet_files)}")

    for page_idx, sheet_file in enumerate(sheet_files):
        with z.open(sheet_file) as fh:
            tree = ET.parse(fh)
            root = tree.getroot()

        ns = {'': root.tag.split('}')[0].lstrip('{') if '}' in root.tag else ''}
        def find_all(node, tag):
            # Try both namespaced and bare tags
            found = node.findall(f'.//{tag}')
            if not found and ns.get(''):
                found = node.findall('.//{%s}%s' % (ns[''], tag))
            return found

        measures = []
        # Audiveris stores measures as <Measure> nodes with optional <Bounds> children
        for m in find_all(root, 'Measure'):
            m_id  = m.get('id') or m.get('number') or ''
            # Bounds as child element
            bounds_el = m.find('Bounds') or m.find('.//{http://www.audiveris.org}Bounds')
            if bounds_el is None:
                bounds_el = m.find('./Bounds')
            if bounds_el is not None:
                x = float(bounds_el.get('x', 0))
                y = float(bounds_el.get('y', 0))
                w = float(bounds_el.get('width', 0))
                h = float(bounds_el.get('height', 0))
                measures.append({'id': m_id, 'x': x, 'y': y, 'w': w, 'h': h})
            else:
                # Bounds may be encoded as attribute "box" = "x y w h"
                box = m.get('box', '')
                if box:
                    parts = box.split()
                    if len(parts) == 4:
                        x, y, w, h = map(float, parts)
                        measures.append({'id': m_id, 'x': x, 'y': y, 'w': w, 'h': h})
                else:
                    measures.append({'id': m_id, 'x': None, 'y': None, 'w': None, 'h': None})

        results.append({'page': page_idx + 1, 'file': sheet_file, 'measures': measures})
        print(f"  Page {page_idx+1}: {len(measures)} measures detected")

with open(json_path, 'w') as f:
    json.dump(results, f, indent=2)
print(f"✓ Bounding boxes written: {json_path}")
PYEOF

echo ""
echo "Done. Summary:"
echo "  MusicXML : $MXL_OUT"
echo "  Bounds   : $JSON_OUT"
