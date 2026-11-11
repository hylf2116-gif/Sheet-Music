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
    await run(AUDIVERIS_BIN, ['-batch', '-export', '-output', outDir, '--', pdfPath], { timeout: timeoutMs });
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

module.exports = { audiverisAvailable, runAudiveris, extractMeasures, AUDIVERIS_BIN };
