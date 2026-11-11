/**
 * Glyph extraction — CommonJS (opentype.js needs CJS context)
 */
const opentype = require('opentype.js');
const { writeFileSync, readFileSync } = require('fs');
const { dirname, resolve } = require('path');

const __dir = __dirname;

const BRAVURA_SYMBOLS = {
  downBow:      0xE610,
  upBow:        0xE612,
  tenuto:       0xE4A4,
  // Fingering digits at SMuFL ED10-ED14 (Bravura v1.4+)
  finger0:      0xED10,
  finger1:      0xED11,
  finger2:      0xED12,
  finger3:      0xED13,
  finger4:      0xED14,
  thumb:        0xE624,
  dynamicPP:    0xE52B,
  dynamicP:     0xE520,
  dynamicMP:    0xE52C,
  dynamicMF:    0xE52D,
  dynamicF:     0xE522,
  dynamicFF:    0xE52F,
  crescendo:    0xE53E,
  decrescendo:  0xE53F,
  accent:       0xE4A0,
  fermata:      0xE4C0,
  repeat:       0xE504,
  segno:        0xE047,
  coda:         0xE048,
  breathMark:   0xE4CE,
  caesura:      0xE4D1,
};

function pathBbox(cmds) {
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  function pt(x,y){ if(x<x1)x1=x;if(x>x2)x2=x;if(y<y1)y1=y;if(y>y2)y2=y; }
  for(const c of cmds){
    if(c.type==='M'||c.type==='L') pt(c.x,c.y);
    else if(c.type==='C'){pt(c.x1,c.y1);pt(c.x2,c.y2);pt(c.x,c.y);}
    else if(c.type==='Q'){pt(c.x1,c.y1);pt(c.x,c.y);}
  }
  return {x1,y1,x2,y2,w:x2-x1,h:y2-y1};
}

function normalizePath(cmds) {
  const bbox = pathBbox(cmds);
  if(bbox.w<=0||bbox.h<=0) return null;
  const scale = 100/Math.max(bbox.w,bbox.h);
  const tx = -bbox.x1, ty = -bbox.y1;
  const normedW = bbox.w*scale, normedH = bbox.h*scale;
  const parts=[];
  for(const c of cmds){
    const x=v=>(v+tx)*scale, y=v=>(v+ty)*scale;
    if(c.type==='M') parts.push(`M${x(c.x).toFixed(2)},${y(c.y).toFixed(2)}`);
    else if(c.type==='L') parts.push(`L${x(c.x).toFixed(2)},${y(c.y).toFixed(2)}`);
    else if(c.type==='C') parts.push(`C${x(c.x1).toFixed(2)},${y(c.y1).toFixed(2)} ${x(c.x2).toFixed(2)},${y(c.y2).toFixed(2)} ${x(c.x).toFixed(2)},${y(c.y).toFixed(2)}`);
    else if(c.type==='Q') parts.push(`Q${x(c.x1).toFixed(2)},${y(c.y1).toFixed(2)} ${x(c.x).toFixed(2)},${y(c.y).toFixed(2)}`);
    else if(c.type==='Z') parts.push('Z');
  }
  return { d: parts.join(' '), w: normedW, h: normedH };
}

function extractGlyph(font, cp) {
  const idx = font.charToGlyphIndex(String.fromCodePoint(cp));
  if(idx===0) return null;
  const glyph = font.glyphs.get(idx);
  const path = glyph.getPath(0,0,1000);
  const cmds = path.commands;
  if(!cmds||cmds.length<=1) return null;
  return normalizePath(cmds);
}

function composeChars(font, chars) {
  const SIZE=1000, GAP=20;
  let offsetX=0;
  const allCmds=[];
  for(const ch of chars){
    const idx=font.charToGlyphIndex(ch);
    if(idx===0) continue;
    const glyph=font.glyphs.get(idx);
    const path=glyph.getPath(offsetX,0,SIZE);
    for(const c of path.commands) allCmds.push(c);
    const adv=glyph.advanceWidth*(SIZE/font.unitsPerEm);
    offsetX+=adv+(ch==='.'?GAP/2:GAP);
  }
  return normalizePath(allCmds);
}

function loadFont(p) {
  const buf = readFileSync(p);
  const ua = new Uint8Array(buf);
  const ab = ua.buffer.slice(ua.byteOffset, ua.byteOffset + ua.byteLength);
  return opentype.parse(ab);
}

function main() {
  console.log('Loading fonts…');
  const bravura = loadFont(resolve(__dir,'Bravura.otf'));
  // STIX Two from @fontsource package (SIL OFL 1.1)
  const stixPath = resolve(__dir,'node_modules/@fontsource/stix-two-text/files/stix-two-text-latin-400-italic.woff');
  const stix    = loadFont(stixPath);
  console.log(`  Bravura: ${bravura.numGlyphs} glyphs, UPM=${bravura.unitsPerEm}`);
  console.log(`  STIX:    ${stix.numGlyphs} glyphs, UPM=${stix.unitsPerEm}`);

  const results={};
  const failed=[];

  for(const [name,cp] of Object.entries(BRAVURA_SYMBOLS)){
    const r=extractGlyph(bravura,cp);
    if(r){ results[name]=r; console.log(`  ✓ ${name}  (${r.w.toFixed(1)}×${r.h.toFixed(1)})`); }
    else { failed.push(`${name}(U+${cp.toString(16).toUpperCase()})`); console.warn(`  ✗ ${name}  — empty/missing`); }
  }

  const dc=composeChars(stix,['D','.','C','.']);
  if(dc){ results['dc']=dc; console.log(`  ✓ dc  (${dc.w.toFixed(1)}×${dc.h.toFixed(1)})`); }
  else  { failed.push('dc'); console.warn('  ✗ dc'); }

  const ds=composeChars(stix,['D','.','S','.']);
  if(ds){ results['ds']=ds; console.log(`  ✓ ds  (${ds.w.toFixed(1)}×${ds.h.toFixed(1)})`); }
  else  { failed.push('ds'); console.warn('  ✗ ds'); }

  // Custom slur arc (open curve)
  results['slur']={ d:'M0,70 C25,10 75,10 100,70', w:100, h:70 };
  console.log('  ✓ slur  (custom)');

  // Custom staccato dot (small filled circle)
  results['staccato']={ d:'M50,0 A50,50 0 1,0 50,100 A50,50 0 1,0 50,0 Z', w:100, h:100 };
  console.log('  ✓ staccato  (custom circle)');

  if(failed.length) console.warn('\nMissing:', failed.join(', '));

  writeFileSync(resolve(__dir,'glyphs.json'), JSON.stringify(results,null,2));
  console.log('\nWrote glyphs.json');

  // ── Emit symbols.ts ───────────────────────────────────────────────────
  const groups = {
    bowing:       ['downBow','upBow','slur','tenuto'],
    fingering:    ['finger0','finger1','finger2','finger3','finger4','thumb'],
    dynamics:     ['dynamicPP','dynamicP','dynamicMP','dynamicMF','dynamicF','dynamicFF','crescendo','decrescendo'],
    articulation: ['staccato','accent','tenuto','fermata'],
    structure:    ['repeat','segno','coda','dc','ds','breathMark','caesura'],
  };

  const labels = {
    downBow:'Down-bow', upBow:'Up-bow', slur:'Slur', staccato:'Staccato',
    tenuto:'Tenuto', finger0:'Open (0)', finger1:'Finger 1', finger2:'Finger 2',
    finger3:'Finger 3', finger4:'Finger 4', thumb:'Thumb', dynamicPP:'pp',
    dynamicP:'p', dynamicMP:'mp', dynamicMF:'mf', dynamicF:'f', dynamicFF:'ff',
    crescendo:'Crescendo', decrescendo:'Decrescendo', accent:'Accent',
    fermata:'Fermata', repeat:'Repeat', segno:'Segno', coda:'Coda',
    dc:'D.C. (Da Capo)', ds:'D.S. (Dal Segno)', breathMark:'Breath mark', caesura:'Caesura',
  };

  const groupLabels = {bowing:'Bowing',fingering:'Fingering',dynamics:'Dynamics',articulation:'Articulation',structure:'Structure'};
  const allIds = Object.keys(results);

  const lines=[
    '// Auto-generated by scripts/extract-glyphs.mjs — do not edit',
    '// Bravura © Steinberg Media Technologies GmbH (SIL OFL 1.1)',
    '// STIX Two © The STIX Fonts Project Authors (SIL OFL 1.1)',
    '',
    'export interface SymbolDef {',
    '  d: string;',
    '  w: number;',
    '  h: number;',
    '}',
    '',
    'export type SymbolId =',
    '  | ' + allIds.map(k=>`'${k}'`).join('\n  | ') + ';',
    '',
    'export const SYMBOL_DEFS: Record<SymbolId, SymbolDef> = {',
  ];
  for(const [k,v] of Object.entries(results)){
    lines.push(`  ${k}: { d: ${JSON.stringify(v.d)}, w: ${v.w.toFixed(2)}, h: ${v.h.toFixed(2)} },`);
  }
  lines.push('};','');
  lines.push('export type GroupId = '+Object.keys(groups).map(g=>`'${g}'`).join(' | ')+';','');
  lines.push('export interface SymbolGroup {','  id: GroupId;','  label: string;','  symbols: SymbolId[];','}','');
  lines.push('export const SYMBOL_GROUPS: SymbolGroup[] = [');
  for(const [gid,syms] of Object.entries(groups)){
    const vs=syms.filter(s=>results[s]);
    if(!vs.length) continue;
    lines.push(`  { id: '${gid}', label: '${groupLabels[gid]}', symbols: [${vs.map(s=>`'${s}'`).join(', ')}] },`);
  }
  lines.push('];','');
  lines.push('export const SYMBOL_LABELS: Partial<Record<SymbolId, string>> = {');
  for(const id of allIds) lines.push(`  ${id}: ${JSON.stringify(labels[id]??id)},`);
  lines.push('};','');

  const tsOut=resolve(__dir,'symbols.ts');
  writeFileSync(tsOut, lines.join('\n'));
  console.log('Wrote symbols.ts');
}

main();
