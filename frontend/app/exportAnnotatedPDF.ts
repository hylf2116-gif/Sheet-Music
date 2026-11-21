import { PDFDocument, rgb, LineCapStyle } from 'pdf-lib';
import { SYMBOL_DEFS, type SymbolId } from './symbols';

// Transform every x,y pair of an SVG path that uses only absolute M/L/C/Q/Z commands
// (true for all symbol paths in symbols.ts).
function mapPathPoints(d: string, f: (x: number, y: number) => [number, number]): string {
  const tokens = d.match(/[MLCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: string[] = [];
  let pending: number | null = null;
  for (const tk of tokens) {
    if (/^[A-Za-z]$/.test(tk)) { out.push(tk); continue; }
    const n = Number(tk);
    if (pending === null) { pending = n; continue; }
    const [x, y] = f(pending, n);
    out.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    pending = null;
  }
  return out.join(' ');
}

// Render one line of text to a PNG. Sizes come back in ems so the caller can scale them.
const TEXT_EM = 96; // pixels per em: sharp enough for printing
async function textImage(text: string, color: string) {
  if (typeof document === 'undefined') return null;
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = `${TEXT_EM}px ${family}`;
  ctx.font = font;
  const m = ctx.measureText(text);
  const ascent = m.fontBoundingBoxAscent ?? TEXT_EM * 0.9;
  const descent = m.fontBoundingBoxDescent ?? TEXT_EM * 0.25;
  canvas.width = Math.max(1, Math.ceil(m.width));
  canvas.height = Math.max(1, Math.ceil(ascent + descent));
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 0, ascent);
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
  if (!blob) return null;
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width / TEXT_EM,
    ascent: ascent / TEXT_EM,
    descent: descent / TEXT_EM,
  };
}

// Text width (as a fraction of page width) in an SVG set up like the score viewer.
function screenTextWidth(text: string, fs: number, pw: number, ph: number): number | null {
  if (typeof document === 'undefined') return null;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const W = 900;
  svg.setAttribute('viewBox', '0 0 1 1');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(Math.round(W * ph / pw)));
  svg.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden';
  const t = document.createElementNS(ns, 'text');
  t.setAttribute('font-size', String(fs));
  t.textContent = text;
  svg.appendChild(t);
  document.body.appendChild(svg);
  try { const w = t.getComputedTextLength(); return w > 0 ? w : null; }
  finally { svg.remove(); }
}

// ── Filename helpers ──────────────────────────────────────────────────────────

export function buildSuggestedFilename(pdfUrl: string, scoreName?: string): string {
  let base = scoreName?.trim() || '';
  if (!base) {
    try {
      const raw = new URL(pdfUrl).pathname.split('/').pop() ?? '';
      const cleaned = raw.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim();
      // Ignore UUID-looking names (just hex + hyphens)
      if (cleaned && !/^[a-f0-9 -]+$/i.test(cleaned)) base = cleaned;
    } catch {}
  }
  if (!base) base = 'Annotated Score';
  const date = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  return `${base} - ${date}`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

// Catmull-Rom → cubic bezier, coordinates scaled to actual page dimensions.
// x ∈ [0, pw], y ∈ [0, ph] with origin top-left (SVG convention for drawSvgPath).
function buildScaledPath(pts: { x: number; y: number }[], pw: number, ph: number): string {
  if (pts.length === 0) return '';
  if (pts.length < 3) return 'M ' + pts.map(p => `${p.x * pw} ${p.y * ph}`).join(' L ');
  let d = `M ${pts[0].x * pw} ${pts[0].y * ph}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = (p1.x + (p2.x - p0.x) / 6) * pw;
    const c1y = (p1.y + (p2.y - p0.y) / 6) * ph;
    const c2x = (p2.x - (p3.x - p1.x) / 6) * pw;
    const c2y = (p2.y - (p3.y - p1.y) / 6) * ph;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x * pw} ${p2.y * ph}`;
  }
  return d;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns 'native' if the File System Access API was used, 'downloads' if the
 * browser-default blob-download fallback was used.
 * Throws an AbortError (re-thrown from showSaveFilePicker) if the user cancels
 * the native dialog — callers should swallow that silently.
 */
export async function exportAnnotatedPDF(
  pdfUrl: string,
  annotations: any[],
  filename = 'annotated-score.pdf',
): Promise<'native' | 'downloads'> {
  // ── Step 1: open native save dialog first ────────────────────────────────
  // showSaveFilePicker must be called before any async work to stay within the
  // browser's user-activation window.  The dialog is open while the PDF builds.
  let fileHandle: any = null;
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    fileHandle = await (window as any).showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
    });
    // AbortError (user cancelled) propagates to caller — do not catch here.
  }

  // ── Step 2: build the PDF ────────────────────────────────────────────────
  const pdfBytes = await buildAnnotatedPDF(pdfUrl, annotations);

  // ── Step 3: save ─────────────────────────────────────────────────────────
  return saveBytes(pdfBytes, fileHandle, filename);
}

// The score with every annotation drawn onto its pages, as PDF bytes.
export async function buildAnnotatedPDF(pdfUrl: string, annotations: any[]): Promise<Uint8Array> {
  const existingBytes = await fetch(pdfUrl).then(r => r.arrayBuffer());
  const pdfDoc = await PDFDocument.load(existingBytes);
  const pages = pdfDoc.getPages();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const { width: pw, height: ph } = page.getSize();
    const pageAnnotations = annotations.filter(a => a.page === pageIndex);

    for (const ann of pageAnnotations) {
      const color = hexToRgb(ann.color ?? '#000000');
      const sw = ann.strokeWidth ?? 2;

      if (ann.type === 'ellipse' || ann.type === 'circle') {
        const cx = (ann.cx ?? ann.x) * pw;
        const cy = ph - (ann.cy ?? ann.y) * ph; // PDF origin is bottom-left
        const rx = (ann.rx ?? ann.r) * pw;
        const ry = (ann.ry ?? ann.r) * ph;
        page.drawEllipse({ x: cx, y: cy, xScale: rx, yScale: ry, borderColor: color, borderWidth: sw });

      } else if (ann.type === 'line') {
        page.drawLine({
          start: { x: ann.x1 * pw, y: ph - ann.y1 * ph },
          end:   { x: ann.x2 * pw, y: ph - ann.y2 * ph },
          color, thickness: sw, lineCap: LineCapStyle.Round,
        });

      } else if (ann.type === 'highlight') {
        page.drawRectangle({
          x: ann.x * pw,
          y: ph - (ann.y + ann.h) * ph, // bottom-left corner in PDF coords
          width: ann.w * pw, height: ann.h * ph,
          color, opacity: 0.3,
        });

      } else if (ann.type === 'symbol') {
        const def = SYMBOL_DEFS[ann.symbolId as SymbolId];
        if (def && ann.w > 0 && ann.h > 0) {
          // Map the glyph box (font units, y down) onto the annotation box in page points,
          // so stretched hairpins/slurs export exactly as they look on screen.
          const sx = (ann.w * pw) / def.bw;
          const sy = (ann.h * ph) / def.bh;
          const d = mapPathPoints(def.d, (x, y) => [ann.x * pw + (x - def.bx) * sx, ann.y * ph + (y - def.by) * sy]);
          page.drawSvgPath(d, def.fill
            ? { x: 0, y: ph, scale: 1, color }
            : { x: 0, y: ph, scale: 1, borderColor: color, borderWidth: 1.2, borderLineCap: LineCapStyle.Round });
        }

      } else if (ann.type === 'pen') {
        const path = buildScaledPath(ann.points ?? [], pw, ph);
        if (path) {
          // x=0, y=ph places the SVG origin at top-left in PDF space;
          // pdf-lib inverts the y-axis for SVG paths automatically.
          page.drawSvgPath(path, {
            x: 0, y: ph, scale: 1,
            borderColor: color, borderWidth: sw, borderLineCap: LineCapStyle.Round,
            // Highlighter strokes keep their transparency in the exported PDF.
            ...(ann.highlighter ? { borderOpacity: ann.opacity ?? 0.4 } : {}),
          });
        }

      } else if (ann.type === 'text' && ann.text) {
        // Text is drawn as an image so any language works (the built-in PDF fonts only cover
        // Western letters, so Chinese used to break the whole export). On screen the text sits in a
        // 0–1 box stretched to the page: its baseline is at y, its height is fontSize × page height
        // and its width is scaled by the page width.
        const fs = ann.fontSize ?? 0.03;
        const img = await textImage(ann.text, ann.color ?? '#000000');
        if (img) {
          const png = await pdfDoc.embedPng(img.png);
          // Width as the score viewer lays it out (tiny font sizes in its 0–1 box come out a bit
          // wider than normal text), so the export matches what people saw.
          const width = screenTextWidth(ann.text, fs, pw, ph) ?? img.width * fs;
          page.drawImage(png, {
            x: ann.x * pw,
            y: ph - ann.y * ph - img.descent * fs * ph,
            width: width * pw,
            height: (img.ascent + img.descent) * fs * ph,
          });
        }
      }
    }
  }

  return pdfDoc.save();
}

async function saveBytes(pdfBytes: Uint8Array, fileHandle: any, filename: string): Promise<'native' | 'downloads'> {
  if (fileHandle) {
    const writable = await fileHandle.createWritable();
    await writable.write(pdfBytes);
    await writable.close();
    return 'native';
  }

  // Fallback: trigger browser download to Downloads folder.
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloads';
}
