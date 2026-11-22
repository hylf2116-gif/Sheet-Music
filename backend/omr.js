// OMR (optical music recognition) support via Audiveris.
// - runAudiveris(): runs the Audiveris CLI on a PDF (slow: minutes).
// - extractMeasures(): reads the resulting .omr archive and returns measure boxes
//   in normalized page coordinates (0..1), the same convention as annotations.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Audiveris launcher inside the macOS app bundle (it ships its own Java runtime).
const AUDIVERIS_BIN =
  process.env.AUDIVERIS_BIN || path.join(process.env.HOME || '', 'audiveris/Audiveris.app/Contents/MacOS/Audiveris');

// Audiveris cancels a page when one step takes over 120 s (it happens on a busy computer, e.g. during
// a video call). Give each step up to 10 minutes instead.
const STEP_TIMEOUT = ['-constant', 'org.audiveris.omr.Main.sheetStepTimeOut=600'];

function audiverisAvailable() {
  return fs.existsSync(AUDIVERIS_BIN);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024, encoding: 'buffer', ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr ? stderr.toString() : '';
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

// Read progress from the Audiveris log in outDir: "N sheets in ..." and the latest "[stem#K]" tag.
function readProgress(outDir) {
  try {
    const log = fs.readdirSync(outDir).find((f) => f.endsWith('.log'));
    if (!log) return null;
    const text = fs.readFileSync(path.join(outDir, log), 'utf8');
    const total = text.match(/(\d+) sheets? in /);
    let current = 0;
    for (const m of text.matchAll(/\[[^\]#]*#(\d+)\]/g)) current = Math.max(current, Number(m[1]));
    return { page: current || 1, total: total ? Number(total[1]) : null };
  } catch { return null; }
}

// Run Audiveris in batch mode (about 1 minute per page). Resolves with { omrPath, mxlPath|null }.
// onProgress({ page, total }) is called every few seconds while it runs.
async function runAudiveris(pdfPath, outDir, { timeoutMs = 60 * 60 * 1000, onProgress } = {}) {
  if (!audiverisAvailable()) throw new Error(`Audiveris not found at ${AUDIVERIS_BIN}`);
  fs.mkdirSync(outDir, { recursive: true });
  let last = '';
  const timer = onProgress && setInterval(() => {
    const p = readProgress(outDir);
    if (p && JSON.stringify(p) !== last) { last = JSON.stringify(p); onProgress(p); }
  }, 3000);
  try {
    await run(AUDIVERIS_BIN, ['-batch', '-export', ...STEP_TIMEOUT, '-output', outDir, '--', pdfPath], { timeout: timeoutMs });
  } finally {
    if (timer) clearInterval(timer);
  }
  const stem = path.basename(pdfPath, path.extname(pdfPath));
  const files = fs.readdirSync(outDir);
  const omr = files.find((f) => f === `${stem}.omr`) || files.find((f) => f.endsWith('.omr'));
  // Multi-movement scores may produce e.g. "<stem>.mvt1.mxl"; take the first .mxl.
  const mxl = files.find((f) => f === `${stem}.mxl`) || files.filter((f) => f.endsWith('.mxl')).sort()[0];
  if (!omr) throw new Error('Audiveris finished but produced no .omr file');
  return { omrPath: path.join(outDir, omr), mxlPath: mxl ? path.join(outDir, mxl) : null };
}

async function listZip(zipPath) {
  const out = (await run('unzip', ['-Z1', zipPath])).toString();
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function readZipEntry(zipPath, entry) {
  // unzip treats [ ] * ? as wildcards; escape them so "sheet#1/sheet#1.xml" matches literally.
  const escaped = entry.replace(/([[\]*?])/g, '\\$1');
  return (await run('unzip', ['-p', zipPath, escaped])).toString('utf8');
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};

// Parse one sheet XML into systems of measure boxes (pixel units).
function parseSheet(xml) {
  const pic = xml.match(/<picture\s[^>]*>/);
  const width = pic ? Number(attr(pic[0], 'width')) : NaN;
  const height = pic ? Number(attr(pic[0], 'height')) : NaN;
  // Typical distance between staff lines in pixels; a staff is 4 interlines tall.
  const il = xml.match(/<interline\s[^>]*>/);
  const interline = il ? Number(attr(il[0], 'main')) : NaN;
  const systems = [];
  const systemRe = /<system\s[^>]*>([\s\S]*?)<\/system>/g;
  let sm;
  while ((sm = systemRe.exec(xml))) {
    const body = sm[1];
    const stacks = [];
    for (const t of body.match(/<stack\s[^>]*>/g) || []) {
      const left = Number(attr(t, 'left'));
      const right = Number(attr(t, 'right'));
      if (Number.isFinite(left) && Number.isFinite(right) && right > left) stacks.push({ left, right });
    }
    // Vertical extent: all staff-line points in this system.
    let top = Infinity;
    let bottom = -Infinity;
    const linesRe = /<lines>([\s\S]*?)<\/lines>/g;
    let lm;
    while ((lm = linesRe.exec(body))) {
      for (const p of lm[1].match(/<point\s[^>]*>/g) || []) {
        const y = Number(attr(p, 'y'));
        if (Number.isFinite(y)) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    if (stacks.length && Number.isFinite(top)) systems.push({ stacks, top, bottom });
  }
  return { width, height, interline, systems };
}

// Returns { pages: [{ page (0-based), measures: [{ n, x, y, w, h }] }], measureCount }.
// Measure numbers run sequentially through the whole score, starting at 1.
async function extractMeasures(omrPath) {
  const entries = await listZip(omrPath);
  const sheets = entries
    .map((e) => e.match(/^sheet#(\d+)\/sheet#\1\.xml$/))
    .filter(Boolean)
    .map((m) => ({ entry: m[0], num: Number(m[1]) }))
    .sort((a, b) => a.num - b.num);

  const pages = [];
  let n = 0;
  for (const { entry, num } of sheets) {
    const { width, height, interline, systems } = parseSheet(await readZipEntry(omrPath, entry));
    if (!(width > 0 && height > 0)) continue;
    const measures = [];
    systems.sort((a, b) => a.top - b.top);
    for (const sys of systems) {
      // Pad vertically by ~1 staff space so the box covers notes just above/below the staff.
      const pad = Math.max(10, (sys.bottom - sys.top) * 0.15);
      const y0 = Math.max(0, sys.top - pad);
      const y1 = Math.min(height, sys.bottom + pad);
      for (const s of sys.stacks.sort((a, b) => a.left - b.left)) {
        n += 1;
        measures.push({
          n,
          x: s.left / width,
          y: y0 / height,
          w: (s.right - s.left) / width,
          h: (y1 - y0) / height,
        });
      }
    }
    const page = { page: num - 1, measures };
    if (interline > 0) page.staffHeight = (4 * interline) / height;
    pages.push(page);
  }
  return { pages, measureCount: n };
}

// The score itself from a .mxl (compressed MusicXML): the root file named in META-INF/container.xml,
// or else the first .xml that is not in META-INF.
async function readMusicXml(mxlPath) {
  const entries = await listZip(mxlPath);
  let root = null;
  if (entries.includes('META-INF/container.xml')) {
    const container = await readZipEntry(mxlPath, 'META-INF/container.xml');
    const m = container.match(/full-path="([^"]+)"/);
    if (m && entries.includes(m[1])) root = m[1];
  }
  root = root || entries.find((e) => /\.(xml|musicxml)$/i.test(e) && !e.startsWith('META-INF/'));
  if (!root) throw new Error('No score file inside the MusicXML archive');
  return readZipEntry(mxlPath, root);
}

// ── Fast recognition: pages in parallel ──────────────────────────────────────
// One Audiveris run per page (several at once), then the recognized pages are joined into one
// book with an Audiveris "playlist" and exported once. Measured on a 6-page cello suite:
// 650 s → about 195 s, with the same notes. Audiveris' own parallel mode crashes, and exporting
// each page on its own loses movements that start mid-page, hence this route.

const os = require('os');

async function pdfPageCount(pdfPath) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(pdfPath), { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

// How many Audiveris copies to run at once. Each already uses 2–3 cores, so more copies than
// that just fight over the processor (measured on a 4-core/8-thread laptop: 2 at once was the
// steady best). Set OMR_PARALLEL on the server to override.
function parallelRuns() {
  const n = Number(process.env.OMR_PARALLEL);
  if (n >= 1) return Math.floor(n);
  return Math.max(1, Math.min(4, Math.floor(os.cpus().length / 4)));
}

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Same result as runAudiveris (omrPath + MusicXML), but much faster for scores with several pages.
 * Resolves with { omrPath, mxlPaths: [...] } (one MusicXML per movement, in order).
 */
async function runAudiverisFast(pdfPath, outDir, { timeoutMs = 60 * 60 * 1000, onProgress, onPageDone } = {}) {
  if (!audiverisAvailable()) throw new Error(`Audiveris not found at ${AUDIVERIS_BIN}`);
  let pages = 1;
  try { pages = await pdfPageCount(pdfPath); } catch {}
  const stem = path.basename(pdfPath, path.extname(pdfPath));
  fs.mkdirSync(outDir, { recursive: true });

  if (pages <= 1) {
    const r = await runAudiveris(pdfPath, outDir, { timeoutMs, onProgress });
    return { omrPath: r.omrPath, mxlPaths: listMxl(outDir, stem) };
  }

  // 1) every page on its own, a few at a time
  let done = 0;
  onProgress?.({ page: 0, total: pages });
  const pageDir = (k) => path.join(outDir, `p${k}`);
  // Page 1 first and alone (whole processor), so playback can start as early as possible;
  // then the other pages in parallel.
  const runPages = async (queue, copies) => Promise.all(Array.from({ length: Math.min(copies, queue.length) }, async () => {
    while (queue.length) {
      const k = queue.shift();
      const args = ['-batch', '-export', ...STEP_TIMEOUT, '-sheets', String(k), '-output', pageDir(k), '--', pdfPath];
      // One retry: a page can fail just because the computer was busy.
      try { await run(AUDIVERIS_BIN, args, { timeout: timeoutMs }); }
      catch {
        fs.rmSync(pageDir(k), { recursive: true, force: true });
        await run(AUDIVERIS_BIN, args, { timeout: timeoutMs });
      }
      done += 1;
      onProgress?.({ page: done, total: pages });
      // Let the caller publish this page right away (errors there must not stop recognition).
      try { await onPageDone?.(k, path.join(pageDir(k), `${stem}.omr`), listMxl(pageDir(k), stem)); } catch {}
    }
  }));
  await runPages([1], 1);
  await runPages(Array.from({ length: pages - 1 }, (_, i) => i + 2), parallelRuns());

  // 2) join the recognized pages into one book (no recognition again: it copies the results)
  const list = path.join(outDir, `${stem}.xml`);
  const excerpts = [];
  for (let k = 1; k <= pages; k++) {
    const omr = path.join(pageDir(k), `${stem}.omr`);
    if (!fs.existsSync(omr)) throw new Error(`Page ${k} produced no result`);
    excerpts.push(`  <excerpt><path>${xmlEscape(omr)}</path><sheets-selection>${k}</sheets-selection></excerpt>`);
  }
  fs.writeFileSync(list, `<?xml version="1.0" encoding="UTF-8"?>\n<play-list>\n${excerpts.join('\n')}\n</play-list>\n`);
  await run(AUDIVERIS_BIN, ['-batch', '-playlist', list], { timeout: timeoutMs });
  const omrPath = path.join(outDir, `${stem}.omr`);
  if (!fs.existsSync(omrPath)) throw new Error('Joining the pages failed');

  // 3) export the whole score once (MusicXML files are written next to the book)
  await run(AUDIVERIS_BIN, ['-batch', '-export', ...STEP_TIMEOUT, '--', omrPath], { timeout: timeoutMs });
  for (let k = 1; k <= pages; k++) fs.rmSync(pageDir(k), { recursive: true, force: true });
  return { omrPath, mxlPaths: listMxl(outDir, stem) };
}

// MusicXML files of a book, movements in order ("x.mvt2.mxl" after "x.mvt1.mxl").
function listMxl(dir, stem) {
  const mvt = (f) => Number((f.match(/\.mvt(\d+)\.mxl$/) || [])[1] || 0);
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(stem) && f.endsWith('.mxl') && !f.includes('opus'))
    .sort((a, b) => mvt(a) - mvt(b))
    .map((f) => path.join(dir, f));
}

// Join movements into one MusicXML score (bars of later movements appended to the first one's
// parts, in order), so playback and following cover the whole piece.
function mergeMovements(xmls) {
  if (xmls.length <= 1) return xmls[0] || '';
  const partsOf = (xml) => [...xml.matchAll(/<part\s+id="([^"]+)"\s*>([\s\S]*?)<\/part>/g)].map((m) => ({ id: m[1], body: m[2] }));
  const first = xmls[0];
  const base = partsOf(first);
  if (!base.length) return first;
  const extra = base.map(() => []);
  for (const xml of xmls.slice(1)) {
    partsOf(xml).forEach((p, i) => { if (i < extra.length) extra[i].push(p.body); });
  }
  let i = 0;
  return first.replace(/(<part\s+id="[^"]+"\s*>)([\s\S]*?)(<\/part>)/g, (all, open, body, close) => {
    const add = extra[i++] || [];
    return open + body + add.join('') + close;
  });
}

/**
 * Partial result from the pages finished so far: pages 1..k in order, stopping at the first page
 * that is not done yet. The final export (all pages joined) replaces it when everything is done.
 * pageResults: Map<page number, { omrPath, mxlPaths }>
 * Returns { pages, measureCount, xml } or null when page 1 isn't usable yet.
 */
async function partialResult(pageResults) {
  const pages = [];
  const xmls = [];
  let n = 0;
  for (let k = 1; pageResults.has(k); k++) {
    const { omrPath, mxlPaths } = pageResults.get(k);
    const m = await extractMeasures(omrPath);
    const page = m.pages.find((pg) => pg.page === k - 1);
    if (!page || !mxlPaths.length) break;
    const parts = [];
    for (const f of mxlPaths) parts.push(await readMusicXml(f));
    const xml = mergeMovements(parts);
    pages.push({ ...page, measures: page.measures.map((mm) => ({ ...mm, n: ++n })) });
    xmls.push(xml);
  }
  if (!pages.length) return null;
  return { pages, measureCount: n, xml: mergeMovements(xmls) };
}

module.exports = {
  partialResult,
  audiverisAvailable, runAudiveris, runAudiverisFast, extractMeasures, readMusicXml, mergeMovements, AUDIVERIS_BIN,
};
