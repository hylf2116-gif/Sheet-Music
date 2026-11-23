// Draws Unino's practice score (assets/demo-score.pdf): two pages of simple staff music, all original,
// used by the new-user tutorial. Run: node scripts/make-demo-score.cjs
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const W = 595, H = 842;               // A4 in points
const LEFT = 60, RIGHT = W - 50;
const GAP = 7;                        // distance between staff lines
const black = rgb(0.1, 0.1, 0.1);

// A short original tune per line: [step offset from the bottom line (0 = E4 line), length 1=quarter 2=half 4=whole]
const LINES = [
  [[2,1],[3,1],[4,1],[2,1], [4,1],[5,1],[6,2], [5,1],[4,1],[3,1],[2,1], [1,2],[0,2]],
  [[0,1],[2,1],[4,1],[6,1], [5,2],[4,2], [3,1],[4,1],[5,1],[3,1], [2,4]],
  [[6,1],[5,1],[4,1],[5,1], [6,2],[6,2], [7,1],[6,1],[5,1],[4,1], [3,4]],
  [[2,1],[2,1],[4,1],[4,1], [5,1],[5,1],[4,2], [3,1],[3,1],[2,1],[2,1], [0,4]],
  [[4,2],[5,2], [6,1],[5,1],[4,1],[3,1], [2,1],[3,1],[4,2], [2,4]],
];

function staff(page, top, notes, font) {
  for (let i = 0; i < 5; i++) page.drawLine({ start: { x: LEFT, y: top - i * GAP }, end: { x: RIGHT, y: top - i * GAP }, thickness: 0.7, color: black });
  const bottom = top - 4 * GAP;
  page.drawText('4', { x: LEFT + 8, y: bottom + 2 * GAP + 1, size: 13, font, color: black });
  page.drawText('4', { x: LEFT + 8, y: bottom + 2, size: 13, font, color: black });
  // bars of 4 beats
  const beats = notes.reduce((s, n) => s + n[1], 0);
  const x0 = LEFT + 34, span = RIGHT - x0 - 6;
  let beat = 0;
  const xAt = (b) => x0 + (b / beats) * span;
  for (const [step, len] of notes) {
    const x = xAt(beat) + 10, y = bottom + step * (GAP / 2);
    const hollow = len >= 2;
    page.drawEllipse({ x, y, xScale: 4.6, yScale: 3.4, color: hollow ? undefined : black, borderColor: black, borderWidth: hollow ? 1.2 : 0 });
    if (len < 4) {
      const up = step < 4;
      page.drawLine({ start: { x: up ? x + 4.3 : x - 4.3, y }, end: { x: up ? x + 4.3 : x - 4.3, y: up ? y + 24 : y - 24 }, thickness: 0.9, color: black });
    }
    beat += len;
    if (beat % 4 === 0) page.drawLine({ start: { x: xAt(beat) + 2, y: top }, end: { x: xAt(beat) + 2, y: bottom }, thickness: beat === beats ? 2 : 0.8, color: black });
  }
}

(async () => {
  const doc = await PDFDocument.create();
  doc.setTitle('Unino practice score');
  doc.setAuthor('Unino');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  for (let p = 0; p < 2; p++) {
    const page = doc.addPage([W, H]);
    if (p === 0) {
      page.drawText('Practice Score', { x: W / 2 - bold.widthOfTextAtSize('Practice Score', 26) / 2, y: H - 90, size: 26, font: bold, color: black });
      const sub = 'Unino tutorial · try drawing, writing and turning pages';
      page.drawText(sub, { x: W / 2 - font.widthOfTextAtSize(sub, 12) / 2, y: H - 112, size: 12, font, color: rgb(0.35, 0.35, 0.35) });
      page.drawText('Moderato', { x: LEFT, y: H - 150, size: 12, font: bold, color: black });
    } else {
      page.drawText('Practice Score · page 2', { x: LEFT, y: H - 70, size: 12, font, color: rgb(0.35, 0.35, 0.35) });
    }
    let top = p === 0 ? H - 185 : H - 110;
    for (let i = 0; i < 6; i++) {
      staff(page, top, LINES[(i + p * 3) % LINES.length], bold);
      top -= 105;
    }
    page.drawText(`${p + 1}`, { x: W / 2 - 3, y: 30, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
  }
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'demo-score.pdf'), await doc.save());
  console.log('wrote assets/demo-score.pdf');
})();
