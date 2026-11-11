const opentype = require('./node_modules/opentype.js/dist/opentype.js');
const fs = require('fs');
const path = require('path');

const glyphnames = JSON.parse(fs.readFileSync('./glyphnames.json', 'utf8'));
const bravuraBuf = fs.readFileSync('./Bravura.otf');
const bravura = opentype.parse(new Uint8Array(bravuraBuf).buffer);

function cpFromSmufl(name) {
  const entry = glyphnames[name];
  if (!entry) throw new Error(`SMuFL name not found: ${name}`);
  return parseInt(entry.codepoint.replace('U+', ''), 16);
}

function pathBbox(cmds) {
  let x1=Infinity, y1=Infinity, x2=-Infinity, y2=-Infinity;
  const pt = (x,y) => { if(x<x1)x1=x; if(x>x2)x2=x; if(y<y1)y1=y; if(y>y2)y2=y; };
  for (const c of cmds) {
    if (c.type==='M'||c.type==='L') pt(c.x,c.y);
    else if (c.type==='C') { pt(c.x1,c.y1); pt(c.x2,c.y2); pt(c.x,c.y); }
    else if (c.type==='Q') { pt(c.x1,c.y1); pt(c.x,c.y); }
  }
  return { x1,y1,x2,y2, w:x2-x1, h:y2-y1 };
}

function normalize(cmds) {
  const bb = pathBbox(cmds);
  if (bb.w<=0||bb.h<=0) return null;
  const scale = 100 / Math.max(bb.w, bb.h);
  const tx = -bb.x1, ty = -bb.y1;
  const parts = [];
  const x = v => ((v+tx)*scale).toFixed(2);
  const y = v => ((v+ty)*scale).toFixed(2);
  for (const c of cmds) {
    if      (c.type==='M') parts.push(`M${x(c.x)},${y(c.y)}`);
    else if (c.type==='L') parts.push(`L${x(c.x)},${y(c.y)}`);
    else if (c.type==='C') parts.push(`C${x(c.x1)},${y(c.y1)} ${x(c.x2)},${y(c.y2)} ${x(c.x)},${y(c.y)}`);
    else if (c.type==='Q') parts.push(`Q${x(c.x1)},${y(c.y1)} ${x(c.x)},${y(c.y)}`);
    else if (c.type==='Z') parts.push('Z');
  }
  return { d: parts.join(' '), w: +(bb.w*scale).toFixed(2), h: +(bb.h*scale).toFixed(2) };
}

function extract(smuflName) {
  const cp = cpFromSmufl(smuflName);
  const idx = bravura.charToGlyphIndex(String.fromCodePoint(cp));
  if (idx===0) throw new Error(`No glyph in Bravura for ${smuflName} U+${cp.toString(16).toUpperCase()}`);
  const glyph = bravura.glyphs.get(idx);
  const path = glyph.getPath(0,0,1000);
  const r = normalize(path.commands);
  if (!r) throw new Error(`Empty path for ${smuflName}`);
  console.log(`  ✓ ${smuflName} (U+${cp.toString(16).toUpperCase()}) → ${r.w.toFixed(1)}×${r.h.toFixed(1)}`);
  return { ...r, smuflName, cp: `U+${cp.toString(16).toUpperCase()}` };
}

const results = {};

// Look up each by SMuFL name from glyphnames.json (not hard-coded)
const toExtract = {
  // Bowing/articulation
  downBow:    'stringsDownBow',
  upBow:      'stringsUpBow',
  tenuto:     'articTenutoAbove',
  staccato:   'articStaccatoAbove',
  accent:     'articAccentAbove',
  fermata:    'fermataAbove',
  // Fingering - correct SMuFL range ED10-ED14
  finger0:    'fingering0',
  finger1:    'fingering1',
  finger2:    'fingering2',
  finger3:    'fingering3',
  finger4:    'fingering4',
  thumb:      'stringsThumbPosition',
  // Dynamics
  dynamicPP:  'dynamicPP',
  dynamicP:   'dynamicPiano',
  dynamicMP:  'dynamicMP',
  dynamicMF:  'dynamicMF',
  dynamicF:   'dynamicForte',
  dynamicFF:  'dynamicFF',
  // Structure - use repeat1Bar (% measure repeat sign)
  repeat:     'repeat1Bar',
  segno:      'segno',
  coda:       'coda',
  breathMark: 'breathMarkComma',
  caesura:    'caesura',
};

for (const [id, smuflName] of Object.entries(toExtract)) {
  try { results[id] = extract(smuflName); }
  catch(e) { console.error(`  ✗ ${id}: ${e.message}`); }
}

// Custom open paths (no SMuFL glyph for these)
results.slur = {
  d: 'M0.00,100.00 C20.00,0.00 80.00,0.00 100.00,100.00',
  w: 100, h: 100, smuflName: 'custom', cp: 'n/a', fill: false
};
// Open hairpins — two diverging lines, NOT filled
results.crescendo = {
  d: 'M5.00,10.00 L95.00,50.00 L5.00,90.00',
  w: 100, h: 100, smuflName: 'custom open hairpin', cp: 'n/a', fill: false
};
results.decrescendo = {
  d: 'M95.00,10.00 L5.00,50.00 L95.00,90.00',
  w: 100, h: 100, smuflName: 'custom open hairpin', cp: 'n/a', fill: false
};
// detache = same path as tenuto, different annotation role
results.detache = { ...results.tenuto, smuflName: 'articTenutoAbove (détaché role)', id: 'detache' };
// spiccato = same path as staccato dot, different annotation role  
results.spiccato = { ...results.staccato, smuflName: 'articStaccatoAbove (spiccato role)', id: 'spiccato' };

console.log('\nAll results:', Object.keys(results).join(', '));
fs.writeFileSync('./glyphs-fixed.json', JSON.stringify(results, null, 2));
console.log('Wrote glyphs-fixed.json');
