// Shared by the score viewer (screen) and the PDF export, so both draw the same thing.

// ── Text style ────────────────────────────────────────────────────────────────

// Fonts use what the device already has (no downloads). Each list ends with Chinese fonts and a
// generic family, so every device shows something close, and Chinese always works.
export const FONTS = [
  { id: 'sans',      label: 'Sans',        css: 'system-ui, -apple-system, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: 'serif',     label: 'Serif',       css: 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif' },
  { id: 'engraved',  label: 'Engraved',    css: 'Didot, "Bodoni 72", "Bodoni MT", "Times New Roman", "Songti SC", serif' },
  { id: 'hand',      label: 'Handwriting', css: '"Bradley Hand", "Segoe Print", "Kaiti SC", "STKaiti", "KaiTi", cursive' },
  { id: 'kai',       label: 'Kai 楷体',    css: '"Kaiti SC", "STKaiti", "KaiTi", "BiauKai", "Songti SC", serif' },
  { id: 'rounded',   label: 'Rounded',     css: '"SF Pro Rounded", "Arial Rounded MT Bold", "Yuanti SC", system-ui, sans-serif' },
  { id: 'condensed', label: 'Condensed',   css: '"Avenir Next Condensed", "Arial Narrow", "PingFang SC", sans-serif-condensed, sans-serif' },
  { id: 'mono',      label: 'Mono',        css: '"SF Mono", Menlo, Consolas, "PingFang SC", monospace' },
] as const;
export type FontId = typeof FONTS[number]['id'];

// Font size is a fraction of the page height (0.03 was the only size before).
export const TEXT_SIZES = [
  { id: 'S',  size: 0.02 },
  { id: 'M',  size: 0.03 },
  { id: 'L',  size: 0.045 },
  { id: 'XL', size: 0.065 },
] as const;

export interface TextStyle { bold: boolean; italic: boolean; font: FontId; fontSize: number }
export const DEFAULT_TEXT_STYLE: TextStyle = { bold: false, italic: false, font: 'sans', fontSize: 0.03 };

export function fontCss(font?: string): string {
  return (FONTS.find(f => f.id === font) ?? FONTS[0]).css;
}

// A canvas `font` string for a text annotation, at a given pixel size.
export function canvasFont(a: { bold?: boolean; italic?: boolean; font?: string }, px: number): string {
  return `${a.italic ? 'italic ' : ''}${a.bold ? 'bold ' : ''}${px}px ${fontCss(a.font)}`;
}

// Rough text width in ems (used for the selection box). CJK characters are about 1 em wide.
export function estimateEms(text: string, bold?: boolean): number {
  let ems = 0;
  for (const ch of text) ems += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 1 : 0.56;
  return ems * (bold ? 1.06 : 1);
}

// ── Arrows ────────────────────────────────────────────────────────────────────

// An arrow is a 'line' annotation with arrowEnd (and arrowStart for a double arrow).
// Head size in page pixels/points, so heads keep their shape on stretched pages.
export function arrowHeadLength(strokeWidth: number) { return Math.max(9, strokeWidth * 3.6); }

/**
 * Triangle for an arrowhead at (tipX, tipY) pointing away from (fromX, fromY).
 * All coordinates are in the same units (pixels or PDF points). Returns the 3 corners and the
 * point where the shaft should stop, so a round line cap does not poke through the tip.
 */
export function arrowHead(fromX: number, fromY: number, tipX: number, tipY: number, length: number) {
  const dx = tipX - fromX, dy = tipY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const L = Math.min(length, len * 0.6);
  const ux = dx / len, uy = dy / len;
  const half = L * 0.45;
  const bx = tipX - ux * L, by = tipY - uy * L;
  return {
    points: [[tipX, tipY], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]] as [number, number][],
    shaftEnd: [tipX - ux * L * 0.7, tipY - uy * L * 0.7] as [number, number],
  };
}

// ── Templates: ready-made teaching marks, stamped with one click ──────────────

export interface TemplateDef {
  id: string;
  label: string;   // English source text; translated with t()
  icon: string;    // short preview shown on the button
  // Builds the marks around the clicked point (x, y are 0–1 page coordinates).
  // `t` translates the words, so a Chinese interface stamps Chinese words.
  build: (x: number, y: number, color: string, t: (s: string) => string) => Record<string, unknown>[];
}

const txt = (x: number, y: number, text: string, color: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'text', x, y, text, color, fontSize: 0.026, bold: true, font: 'sans', ...extra });

export const TEMPLATES: TemplateDef[] = [
  { id: 'practice', label: 'Practice here', icon: '▭ ×3',
    build: (x, y, c, t) => [
      { type: 'highlight', x: x - 0.01, y: y - 0.02, w: 0.24, h: 0.045, color: '#ffcc00' },
      txt(x - 0.01, y - 0.028, t('Practice here ×3'), c),
    ] },
  { id: 'intonation', label: 'Check intonation', icon: '◯ ♯♭',
    build: (x, y, c, t) => [
      { type: 'ellipse', cx: x + 0.04, cy: y, rx: 0.05, ry: 0.022, color: c, strokeWidth: 2 },
      txt(x + 0.1, y + 0.008, t('Intonation!'), c),
    ] },
  { id: 'rhythm', label: 'Count the rhythm', icon: '1 & 2 &',
    build: (x, y, c, t) => [txt(x, y, t('Count: 1 & 2 &'), c, { italic: true })] },
  { id: 'slow', label: 'Slow practice', icon: '♩=60',
    build: (x, y, c, t) => [txt(x, y, t('Slow practice ♩ = 60'), c)] },
  { id: 'look', label: 'Look here', icon: '↓',
    build: (x, y, c, t) => [
      txt(x - 0.03, y - 0.06, t('Look here'), c),
      { type: 'line', x1: x, y1: y - 0.05, x2: x, y2: y - 0.008, color: c, strokeWidth: 2, arrowEnd: true },
    ] },
  { id: 'shift', label: 'Shift position', icon: '↗',
    build: (x, y, c, t) => [
      { type: 'line', x1: x, y1: y, x2: x + 0.08, y2: y - 0.025, color: c, strokeWidth: 2, arrowEnd: true },
      txt(x + 0.09, y - 0.025, t('Shift'), c),
    ] },
  { id: 'bow', label: 'Bow distribution', icon: '⊓ V',
    build: (x, y, c, t) => [txt(x, y, t('Save bow'), c, { italic: true })] },
  { id: 'dynamics', label: 'Watch dynamics', icon: 'p < f',
    build: (x, y, c, t) => [txt(x, y, t('Watch dynamics'), c, { font: 'serif', italic: true })] },
  { id: 'relax', label: 'Relax', icon: '~',
    build: (x, y, c, t) => [txt(x, y, t('Relax your shoulder'), c)] },
  { id: 'memorize', label: 'Memorize', icon: '★',
    build: (x, y, c, t) => [txt(x, y, '★ ' + t('Memorize'), c)] },
  { id: 'repeat', label: 'Repeat 5 times', icon: '×5',
    build: (x, y, c, t) => [txt(x, y, t('Repeat ×5'), c)] },
  { id: 'good', label: 'Well done', icon: '✓',
    build: (x, y, _c, t) => [txt(x, y, '✓ ' + t('Well done!'), '#34c759', { fontSize: 0.03 })] },
];
