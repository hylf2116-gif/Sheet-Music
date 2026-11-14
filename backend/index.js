const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

// ── Load .env (no dotenv dependency required) ──────────────────────────────
function loadEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
loadEnv(path.join(__dirname, '.env'));
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// ── Crypto helpers ─────────────────────────────────────────────────────────
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeCompareHash(a, b) {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch { return false; }
}

async function verifySupabaseToken(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken) return null;
  return new Promise((resolve) => {
    const url = new URL('/auth/v1/user', SUPABASE_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data).id || null); } catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── Settings (environment variables; defaults are for local development) ────
// PORT             port to listen on (hosts like Railway set this automatically)
// FRONTEND_ORIGIN  website address(es) allowed to connect, comma-separated
// DATA_DIR         folder for rooms.json, OMR results and uploads (point it at a persistent volume online)
// ENABLE_OMR       'false' turns measure detection off (online servers have no Audiveris)
const PORT = Number(process.env.PORT) || 3001;
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const OMR_ENABLED = process.env.ENABLE_OMR !== 'false';

// ── Express + Socket.IO setup ──────────────────────────────────────────────
const app = express();
// Behind a hosting proxy (HTTPS is handled by the host): trust it for the real client IP.
app.set('trust proxy', 1);
app.use(cors({ origin: FRONTEND_ORIGINS }));
app.use(express.json({ limit: '1mb' }));

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
// With DATA_DIR set (online), uploads live on the same volume; locally they stay in backend/uploads.
const UPLOADS_DIR = process.env.DATA_DIR ? path.join(DATA_DIR, 'uploads') : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// Simple per-IP limit for expensive routes (in memory; fine for a single server).
function rateLimit(max, windowMs, message) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) { hits.set(key, { start: now, count: 1 }); return next(); }
    if (h.count >= max) return res.status(429).json({ error: message });
    h.count += 1;
    next();
  };
}
const uploadLimit = rateLimit(20, 60 * 60 * 1000, 'Too many uploads. Try again in an hour.');
const createRoomLimit = rateLimit(60, 60 * 60 * 1000, 'Too many new rooms. Try again in an hour.');

// Health check for the hosting platform.
app.get('/health', (req, res) => res.json({ ok: true }));

// Recursively verify all numeric values are finite (NaN serialises to null in JSON).
function isValidChanges(obj) {
  if (obj == null || typeof obj !== 'object') return false;
  for (const v of Object.values(obj)) {
    if (typeof v === 'number' && !Number.isFinite(v)) return false;
    if (v === null) return false;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item != null && typeof item === 'object') {
          for (const pv of Object.values(item)) {
            if (typeof pv === 'number' && !Number.isFinite(pv)) return false;
            if (pv === null) return false;
          }
        }
      }
    }
  }
  return true;
}

function loadRooms() {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
      for (const id of Object.keys(data)) {
        // Reset session-only state on server restart
        data[id].hostId = null;
        data[id].hostSockets = new Set();
        data[id].raisedHands = [];
        data[id].messages = [];
        if (data[id].currentPage === undefined) data[id].currentPage = 0;
        const before = (data[id].shapes || []).length;
        data[id].shapes = (data[id].shapes || []).filter((s) => isValidChanges(s));
        const dropped = before - data[id].shapes.length;
        if (dropped > 0) console.warn(`Room ${id}: dropped ${dropped} annotation(s) with corrupt geometry`);
      }
      return data;
    }
  } catch (e) {
    console.error('Failed to load rooms:', e);
    // Keep the unreadable file instead of letting the next save overwrite it with an empty list.
    try {
      const keep = `${ROOMS_FILE}.unreadable-${Date.now()}`;
      fs.copyFileSync(ROOMS_FILE, keep);
      console.error(`Copied the unreadable rooms file to ${keep}`);
    } catch {}
  }
  return {};
}

function serializeRooms() {
  // hostSockets is a Set (session-only) — strip before serialising
  const toSave = {};
  for (const [id, room] of Object.entries(rooms)) {
    const { hostSockets, ...rest } = room;
    toSave[id] = rest;
  }
  return JSON.stringify(toSave, null, 2);
}

// Saving is coalesced and atomic. Bursts of changes (e.g. erasing) used to start many
// overlapping fs.writeFile calls on the same file; a shorter write could leave the tail of a
// longer one behind and corrupt rooms.json. Now: at most one write at a time, to a temp file
// that is then renamed over rooms.json (rename is atomic), so the file is never half-written.
let saveTimer = null;
let saveInProgress = false;
let saveAgain = false;

function saveRooms() {
  if (saveTimer) return;
  saveTimer = setTimeout(flushRooms, 150);
}

function flushRooms() {
  saveTimer = null;
  if (saveInProgress) { saveAgain = true; return; }
  saveInProgress = true;
  const tmp = `${ROOMS_FILE}.tmp`;
  fs.writeFile(tmp, serializeRooms(), (err) => {
    if (err) { console.error('Failed to save rooms:', err); return finishSave(); }
    fs.rename(tmp, ROOMS_FILE, (err2) => {
      if (err2) console.error('Failed to save rooms:', err2);
      finishSave();
    });
  });
}

function finishSave() {
  saveInProgress = false;
  if (saveAgain) { saveAgain = false; flushRooms(); }
}

// Write any pending changes before the server stops.
function saveRoomsSync() {
  try {
    const tmp = `${ROOMS_FILE}.tmp`;
    fs.writeFileSync(tmp, serializeRooms());
    fs.renameSync(tmp, ROOMS_FILE);
  } catch (e) { console.error('Failed to save rooms on exit:', e); }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { saveRoomsSync(); process.exit(0); });
}

const MAX_UPLOAD_MB = 200; // piano scores and full orchestral scores can be large
const storage = multer.diskStorage({
  // Absolute path: works no matter which folder the server is started from.
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  // Always .pdf, never the uploader's own extension.
  filename: (req, file, cb) => cb(null, `${uuidv4()}.pdf`),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: FRONTEND_ORIGINS, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 2e6, // largest single message (a long pen stroke is well below this)
});

const rooms = loadRooms();
const socketNames = {};    // socket.id → display name (session-only)
const socketClientId = {}; // socket.id → stable clientId (session-only)

function sanitizeNickname(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[\x00-\x1F\x7F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

// Deduplication excludes the reconnecting client's own sockets so they reclaim their name.
function deduplicateNickname(name, roomId, excludeClientId) {
  const roomSockets = io.sockets.adapter.rooms.get(roomId) || new Set();
  const taken = new Set(
    [...roomSockets]
      .filter((sid) => socketClientId[sid] !== excludeClientId && socketNames[sid])
      .map((sid) => socketNames[sid].toLowerCase()),
  );
  let candidate = name;
  let suffix = 2;
  while (taken.has(candidate.toLowerCase())) candidate = `${name} ${suffix++}`;
  return candidate;
}

const imslp = require('./imslp');

// ── HTTP routes ────────────────────────────────────────────────────────────
// ── Color by person ──────────────────────────────────────────────────────────
// colorMode: 'free'     everyone picks any color per stroke (default, old rooms)
//            'assigned' each person has one color; only the host can change it
//            'self'     each person has one color and may change their own
// Everyone who joins gets a distinct default color so marks are told apart at once.
const COLOR_MODES = ['free', 'assigned', 'self'];
// Readable on white paper; red first for the teacher.
const PERSON_PALETTE = ['#e53935', '#1e88e5', '#43a047', '#8e24aa', '#fb8c00', '#00897b', '#d81b60', '#6d4c41', '#3949ab', '#7cb342'];
const isHexColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const cleanColorMode = (m) => (COLOR_MODES.includes(m) ? m : 'free');

function ensurePersonColor(room, clientId, isHost) {
  if (!room.colorMode || room.colorMode === 'free' || !clientId) return false;
  if (!room.personColors) room.personColors = {};
  if (room.personColors[clientId]) return false;
  const used = new Set(Object.values(room.personColors));
  const pick = isHost && !used.has(PERSON_PALETTE[0])
    ? PERSON_PALETTE[0]
    : PERSON_PALETTE.find((c, i) => i > 0 && !used.has(c)) || PERSON_PALETTE[Object.keys(room.personColors).length % PERSON_PALETTE.length];
  room.personColors[clientId] = pick;
  return true;
}

function personColorsPayload(room) {
  return { mode: room.colorMode || 'free', colors: room.personColors || {}, names: room.personNames || {}, hostClientId: room.hostClientId || null };
}

app.post('/create-room', createRoomLimit, async (req, res) => {
  const { pdfUrl, scoreName: rawScoreName, creatorId, clientId, supabaseToken, colorMode } = req.body || {};
  // Only PDFs uploaded to this server, and only if the file exists.
  if (typeof pdfUrl !== 'string' || !/^\/uploads\/[\w-]+\.pdf$/i.test(pdfUrl)
      || !fs.existsSync(path.join(UPLOADS_DIR, path.basename(pdfUrl)))) {
    return res.status(400).json({ error: 'Upload the PDF first.' });
  }
  const scoreName = typeof rawScoreName === 'string' ? rawScoreName.trim().slice(0, 120) : undefined;
  const roomId = uuidv4();
  const hostToken = crypto.randomBytes(32).toString('hex');

  let hostUserId = null;
  if (supabaseToken) {
    try { hostUserId = await verifySupabaseToken(supabaseToken); } catch {}
  }

  rooms[roomId] = {
    shapes: [],
    messages: [],
    pdfUrl,
    scoreName: scoreName ?? 'Untitled Score',
    currentPage: 0,
    hostId: null,
    hostSockets: new Set(),
    raisedHands: [],
    creatorId: creatorId ?? null,
    // Stable-identity credentials (persisted to rooms.json)
    hostTokenHash: hashToken(hostToken),
    hostClientId: clientId ?? null,
    hostUserId,
    colorMode: cleanColorMode(colorMode),
    personColors: {},
  };
  saveRooms();
  res.json({ roomId, hostToken });
});

app.post('/upload', uploadLimit, (req, res, next) => {
  // Turn multer errors (too large, not a PDF) into clear JSON instead of an HTML error page.
  upload.single('pdf')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `This PDF is larger than ${MAX_UPLOAD_MB} MB. Try a smaller file.` });
    }
    return res.status(400).json({ error: err.message || 'Upload failed.' });
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Path only (no server name), so stored links keep working if the address changes.
  const fileUrl = `/uploads/${req.file.filename}`;
  const scoreName = req.file.originalname.replace(/\.pdf$/i, '').trim() || 'Untitled Score';
  res.json({ url: fileUrl, filename: req.file.filename, scoreName });
});

app.get('/room/:roomId', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    pdfUrl: room.pdfUrl,
    scoreName: room.scoreName ?? 'Untitled Score',
    currentPage: room.currentPage ?? 0,
    imslpSource: room.imslpSource ?? null,
  });
});

// ── IMSLP routes (keep in own section for easy removal) ───────────────────
app.get('/imslp/search', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!imslp.checkUserSearchLimit(ip)) {
    return res.status(429).json({ error: 'rate_limited', message: 'Max 5 IMSLP searches per minute. Please wait.' });
  }
  const q = ((req.query.q || '') + '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'missing_query', message: 'Query parameter q is required.' });
  try {
    const results = await imslp.searchIMSLP(q);
    res.json({ results });
  } catch (err) {
    console.error('IMSLP search error:', err.message);
    if ((err.message || '').includes('timed out')) {
      return res.status(504).json({ error: 'imslp_timeout', message: 'IMSLP did not respond in time. Try again.' });
    }
    res.status(502).json({ error: 'imslp_error', message: 'Could not reach IMSLP. It may be temporarily unavailable.' });
  }
});

app.post('/imslp/import', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!imslp.checkUserImportLimit(ip)) {
    return res.status(429).json({ error: 'rate_limited', message: 'Max 3 IMSLP imports per minute. Please wait.' });
  }
  const { fileUrl, pageUrl, clientId, supabaseToken, colorMode } = req.body;
  if (!fileUrl) return res.status(400).json({ error: 'missing_url', message: 'fileUrl is required.' });

  try {
    const { filename, finalUrl, size } = await imslp.importFromUrl(fileUrl, UPLOADS_DIR);
    const pdfFileUrl = `/uploads/${filename}`;

    // Extract a human-readable score name from the CDN filename
    let scoreName = 'IMSLP Score';
    try {
      const urlPath = new URL(finalUrl).pathname;
      const basename = path.basename(decodeURIComponent(urlPath), '.pdf');
      // CDN filenames look like "IMSLP22895-PMLP52387-Bruch_88a_1" — take the part after the second dash
      const parts = basename.split('-');
      if (parts.length >= 3) {
        scoreName = parts.slice(2).join(' ').replace(/_/g, ' ').trim().slice(0, 100) || 'IMSLP Score';
      } else if (basename.length > 4 && !basename.startsWith('Special')) {
        scoreName = basename.replace(/[-_]/g, ' ').trim().slice(0, 100);
      }
    } catch {}

    const roomId = uuidv4();
    const hostToken = crypto.randomBytes(32).toString('hex');

    let hostUserId = null;
    if (supabaseToken) {
      try { hostUserId = await verifySupabaseToken(supabaseToken); } catch {}
    }

    rooms[roomId] = {
      shapes: [], messages: [], pdfUrl: pdfFileUrl, scoreName,
      currentPage: 0, hostId: null, hostSockets: new Set(), raisedHands: [],
      creatorId: null,
      hostTokenHash: hashToken(hostToken),
      hostClientId: clientId ?? null,
      hostUserId,
      colorMode: cleanColorMode(colorMode),
      personColors: {},
      imslpSource: {
        pageUrl: pageUrl || fileUrl,
        fileUrl: finalUrl,
        importedAt: new Date().toISOString(),
      },
    };
    saveRooms();
    res.json({ roomId, hostToken, pdfUrl: pdfFileUrl, scoreName, imslpPageUrl: pageUrl || fileUrl });
  } catch (err) {
    console.error('IMSLP import error:', err.code, err.message);
    const msg = err.message || 'Could not fetch file from IMSLP.';
    switch (err.code) {
      // Return the original fileUrl so the browser "Open on IMSLP" link is useful, not the intermediate redirect
      case 'IMSLP_HTML_PAGE': return res.status(422).json({ error: 'imslp_html_page', message: msg, finalUrl: fileUrl });
      case 'IS_ZIP':          return res.status(422).json({ error: 'is_zip', message: msg, finalUrl: fileUrl });
      case 'HOST_NOT_ALLOWED':
      case 'NO_HTTPS':        return res.status(400).json({ error: err.code, message: msg });
      case 'PRIVATE_IP':      return res.status(400).json({ error: err.code, message: 'URL resolves to a disallowed address.' });
      case 'NOT_FOUND':       return res.status(404).json({ error: err.code, message: msg });
      case 'FORBIDDEN':       return res.status(403).json({ error: err.code, message: msg });
      case 'TOO_LARGE':       return res.status(413).json({ error: err.code, message: msg });
      case 'BAD_CONTENT_TYPE':return res.status(415).json({ error: err.code, message: msg });
      default: return res.status(502).json({ error: 'upstream_error', message: 'Could not fetch file from IMSLP. It may require manual download.' });
    }
  }
});

// ── OMR (measure detection via Audiveris) ──────────────────────────────────
// Results are cached per PDF file in data/omr/<pdf-stem>/ so rooms sharing a PDF share them.
const omr = require('./omr');
const OMR_DIR = path.join(DATA_DIR, 'omr');
const omrJobs = {}; // pdf stem → { status: 'running' | 'error', error?, startedAt }

// Resolve a room's PDF to a local file in uploads/, or null.
function roomPdfFile(room) {
  try {
    // pdfUrl is '/uploads/<file>.pdf' (or a full URL in older rooms).
    const name = path.basename(new URL(room.pdfUrl, 'http://local').pathname);
    if (!/^[\w-]+\.pdf$/i.test(name)) return null;
    const file = path.join(UPLOADS_DIR, name);
    return fs.existsSync(file) ? { file, stem: name.replace(/\.pdf$/i, '') } : null;
  } catch { return null; }
}

function readOmrResult(stem) {
  try { return JSON.parse(fs.readFileSync(path.join(OMR_DIR, stem, 'measures.json'), 'utf8')); } catch { return null; }
}

// Public OMR state for a room (sent to clients).
function omrStateFor(room) {
  const pdf = roomPdfFile(room);
  const base = { highlightedMeasure: room.highlightedMeasure ?? null };
  if (!pdf) return { ...base, status: 'unavailable', reason: 'PDF file not found on server' };
  const job = omrJobs[pdf.stem];
  if (job?.status === 'running') return { ...base, status: 'running', startedAt: job.startedAt, progress: job.progress ?? null };
  const result = readOmrResult(pdf.stem);
  if (result) {
    return {
      ...base, status: 'done', pages: result.pages, measureCount: result.measureCount,
      hasMusicXml: fs.existsSync(path.join(OMR_DIR, pdf.stem, 'score.mxl')),
    };
  }
  if (job?.status === 'error') return { ...base, status: 'error', error: job.error };
  if (!OMR_ENABLED) return { ...base, status: 'unavailable', reason: 'Measure detection is only available in the local version.' };
  if (!omr.audiverisAvailable()) return { ...base, status: 'unavailable', reason: 'Audiveris is not installed on the server' };
  return { ...base, status: 'none' };
}

// Send the current OMR state to every room that uses this PDF.
function broadcastOmrState(stem) {
  for (const [rid, room] of Object.entries(rooms)) {
    if (roomPdfFile(room)?.stem === stem) io.to(rid).emit('omr-state', omrStateFor(room));
  }
}

async function startOmrJob(pdf) {
  if (omrJobs[pdf.stem]?.status === 'running') return;
  omrJobs[pdf.stem] = { status: 'running', startedAt: Date.now() };
  broadcastOmrState(pdf.stem);
  const outDir = path.join(OMR_DIR, pdf.stem);
  const workDir = path.join(outDir, 'work');
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
    const { omrPath, mxlPath } = await omr.runAudiveris(pdf.file, workDir, {
      onProgress: (p) => { omrJobs[pdf.stem].progress = p; broadcastOmrState(pdf.stem); },
    });
    const result = await omr.extractMeasures(omrPath);
    if (mxlPath) fs.copyFileSync(mxlPath, path.join(outDir, 'score.mxl'));
    fs.writeFileSync(path.join(outDir, 'measures.json'), JSON.stringify(result));
    fs.rmSync(workDir, { recursive: true, force: true });
    delete omrJobs[pdf.stem];
    console.log(`OMR done for ${pdf.stem}: ${result.measureCount} measures`);
  } catch (err) {
    console.error(`OMR failed for ${pdf.stem}:`, err.message, err.stderr?.slice(-500) || '');
    omrJobs[pdf.stem] = { status: 'error', error: 'Measure detection failed. This score may be hard to read automatically.' };
  }
  broadcastOmrState(pdf.stem);
}

app.get('/omr/:roomId/musicxml', (req, res) => {
  const room = rooms[req.params.roomId];
  const pdf = room && roomPdfFile(room);
  const file = pdf && path.join(OMR_DIR, pdf.stem, 'score.mxl');
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'No MusicXML available' });
  const name = (room.scoreName || 'score').replace(/[^\w\- ]+/g, '').trim() || 'score';
  res.download(file, `${name}.mxl`);
});

function emitMemberCount(roomId) {
  const room = rooms[roomId];
  if (!room || !room.hostSockets || room.hostSockets.size === 0) return;
  const count = io.sockets.adapter.rooms.get(roomId)?.size ?? 0;
  for (const hSid of room.hostSockets) {
    if (io.sockets.sockets.get(hSid)) io.to(hSid).emit('room-members-count', count);
  }
}

// ── Socket.IO ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoom = null;
  let isHostSocket = false;    // set in join-room, used by all event handlers on this socket
  let clientIdForSocket = '';  // stable clientId for this socket session

  socket.on('join-room', async (data) => {
    const roomId = typeof data === 'string' ? data : data?.roomId;
    const rawNick = typeof data === 'object' && data ? (data.nickname ?? '') : '';
    const clientId = typeof data === 'object' && data ? (data.clientId ?? null) : null;
    const hostToken = typeof data === 'object' && data ? (data.hostToken ?? null) : null;
    const supabaseToken = typeof data === 'object' && data ? (data.supabaseToken ?? null) : null;

    if (!roomId) return;
    socket.join(roomId);
    currentRoom = roomId;
    const room = rooms[roomId];
    if (!room) return;

    clientIdForSocket = clientId || socket.id; // fallback for legacy clients
    socketClientId[socket.id] = clientIdForSocket;
    isHostSocket = false;
    if (!room.hostSockets) room.hostSockets = new Set(); // defensive init

    // === Host credential verification ===
    if (room.hostTokenHash) {
      // Room already has credentials — check in order: hostToken → Supabase token
      if (hostToken && safeCompareHash(hashToken(hostToken), room.hostTokenHash)) {
        isHostSocket = true;
      } else if (supabaseToken && room.hostUserId) {
        try {
          const userId = await verifySupabaseToken(supabaseToken);
          if (userId && userId === room.hostUserId) isHostSocket = true;
        } catch {}
      }
    } else {
      // Legacy room (no credentials yet).
      // Synchronous check — atomic in the Node.js single-threaded event loop.
      const anyHostConnected =
        room.hostSockets.size > 0 &&
        [...room.hostSockets].some((sid) => io.sockets.sockets.get(sid));

      if (!anyHostConnected) {
        isHostSocket = true;
        room.hostClientId = clientIdForSocket;
        const newToken = crypto.randomBytes(32).toString('hex');
        room.hostTokenHash = hashToken(newToken);
        // Return the token only to this socket — never broadcast
        socket.emit('host-claimed', { hostToken: newToken });
        if (supabaseToken) {
          verifySupabaseToken(supabaseToken)
            .then((userId) => { if (userId) { room.hostUserId = userId; saveRooms(); } })
            .catch(() => {});
        }
      }
    }

    if (isHostSocket) {
      room.hostSockets.add(socket.id);
      room.hostId = socket.id;
      saveRooms();
    }

    // Assign and deduplicate nickname
    let nick = sanitizeNickname(rawNick) || 'Guest';
    nick = deduplicateNickname(nick, roomId, clientIdForSocket);
    socketNames[socket.id] = nick;

    socket.emit('nickname-assigned', { nickname: nick });

    // Dual-keyed nickname map: both socketId and clientId → name so
    // annotation-layer consumers (by clientId) and raised-hand panel (by socketId) work without changes.
    const nickMap = {};
    for (const sid of io.sockets.adapter.rooms.get(roomId) || []) {
      if (socketNames[sid]) {
        nickMap[sid] = socketNames[sid];
        if (socketClientId[sid]) nickMap[socketClientId[sid]] = socketNames[sid];
      }
    }
    socket.emit('nickname-map', nickMap);

    socket.to(roomId).emit('member-joined', {
      socketId: socket.id,
      clientId: clientIdForSocket,
      nickname: nick,
    });

    socket.emit('load-shapes', room.shapes);
    socket.emit('chat-history', room.messages || []);
    socket.emit('room-info', {
      isHost: isHostSocket,
      raisedHands: room.raisedHands,
      currentPage: room.currentPage ?? 0,
    });
    socket.emit('omr-state', omrStateFor(room));
    // Remember names by clientId so the color list still shows people who have left.
    if (!room.personNames) room.personNames = {};
    const nameChanged = room.personNames[clientIdForSocket] !== nick;
    room.personNames[clientIdForSocket] = nick;
    if (ensurePersonColor(room, clientIdForSocket, isHostSocket) || (nameChanged && room.colorMode && room.colorMode !== 'free')) {
      saveRooms();
      io.to(roomId).emit('person-colors', personColorsPayload(room));
    } else {
      socket.emit('person-colors', personColorsPayload(room));
    }
    emitMemberCount(roomId);
  });

  // Change one person's color: the host may change anyone's; in 'self' mode people may change their own.
  socket.on('set-person-color', ({ roomId, clientId, color }) => {
    const room = rooms[roomId];
    if (!room || currentRoom !== roomId || !isHexColor(color) || typeof clientId !== 'string') return;
    if (!room.colorMode || room.colorMode === 'free') return;
    const allowed = isHostSocket || (room.colorMode === 'self' && clientId === clientIdForSocket);
    if (!allowed || !room.personColors || !(clientId in room.personColors)) return;
    room.personColors[clientId] = color.toLowerCase();
    saveRooms();
    io.to(roomId).emit('person-colors', personColorsPayload(room));
  });

  // The host can switch the mode later (e.g. forgot to turn it on when creating the room).
  socket.on('set-color-mode', ({ roomId, mode }) => {
    const room = rooms[roomId];
    if (!room || currentRoom !== roomId || !isHostSocket || !COLOR_MODES.includes(mode)) return;
    room.colorMode = mode;
    if (mode !== 'free') {
      if (!room.personColors) room.personColors = {};
      // Give a color to everyone in the room now, and to everyone who already drew.
      if (room.hostClientId) ensurePersonColor(room, room.hostClientId, true);
      for (const sid of io.sockets.adapter.rooms.get(roomId) || []) ensurePersonColor(room, socketClientId[sid], false);
      for (const sh of room.shapes) ensurePersonColor(room, sh.ownerId, false);
    }
    saveRooms();
    io.to(roomId).emit('person-colors', personColorsPayload(room));
  });

  // OMR: only the host may start measure detection (slow, CPU-heavy).
  socket.on('omr-detect', (roomId) => {
    const room = rooms[roomId];
    if (!room || !isHostSocket) return;
    const pdf = roomPdfFile(room);
    if (!pdf || !OMR_ENABLED || !omr.audiverisAvailable()) return socket.emit('omr-state', omrStateFor(room));
    startOmrJob(pdf);
  });

  // Shared bar highlight: anyone in the room may set or clear it (n = measure number or null).
  socket.on('measure-highlight', ({ roomId, n }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (n !== null && !(Number.isInteger(n) && n > 0 && n < 100000)) return;
    room.highlightedMeasure = n;
    socket.to(roomId).emit('measure-highlight', { n });
  });

  // Host "jump to measure" — everyone scrolls to that bar.
  socket.on('measure-jump', ({ roomId, n }) => {
    if (!rooms[roomId] || !isHostSocket) return;
    if (!(Number.isInteger(n) && n > 0 && n < 100000)) return;
    socket.to(roomId).emit('measure-jump', { n });
  });

  socket.on('rename', ({ roomId, nickname: rawNick }) => {
    const room = rooms[roomId];
    if (!room) return;
    let nick = sanitizeNickname(rawNick) || socketNames[socket.id] || 'Guest';
    nick = deduplicateNickname(nick, roomId, clientIdForSocket);
    socketNames[socket.id] = nick;
    socket.emit('nickname-assigned', { nickname: nick });
    socket.to(roomId).emit('name-changed', { socketId: socket.id, clientId: clientIdForSocket, nickname: nick });
    if (!room.personNames) room.personNames = {};
    room.personNames[clientIdForSocket] = nick;
    saveRooms();
    if (room.colorMode && room.colorMode !== 'free') io.to(roomId).emit('person-colors', personColorsPayload(room));
  });

  socket.on('new-shape', ({ roomId, shape }) => {
    const room = rooms[roomId];
    // Only sockets that joined this room may draw in it.
    if (!room || currentRoom !== roomId) return;
    if (!shape || typeof shape !== 'object' || typeof shape.id !== 'string' || !shape.id) return;
    if (typeof shape.page !== 'number' || !isValidChanges(shape)) return;
    if (room.shapes.some((s) => s.id === shape.id)) return; // ignore duplicates
    // Students always own what they create. The host may keep another owner, because the
    // eraser and undo/redo re-create pieces of other people's strokes on their layers.
    const saved = isHostSocket && typeof shape.ownerId === 'string' && shape.ownerId
      ? shape
      : { ...shape, ownerId: clientIdForSocket };
    room.shapes.push(saved);
    saveRooms();
    socket.to(roomId).emit('new-shape', saved);
  });

  socket.on('delete-shape', ({ roomId, id }) => {
    const room = rooms[roomId];
    if (!room) return;
    const shape = room.shapes.find((s) => s.id === id);
    if (shape) {
      const isOwner = shape.ownerId === clientIdForSocket;
      if (!isHostSocket && !isOwner) return;
      room.shapes = room.shapes.filter((s) => s.id !== id);
      saveRooms();
    }
    socket.to(roomId).emit('delete-shape', id);
  });

  socket.on('undo', ({ roomId, id }) => {
    const room = rooms[roomId];
    if (!room) return;
    const shape = room.shapes.find((s) => s.id === id);
    if (shape) {
      const isOwner = shape.ownerId === clientIdForSocket;
      if (!isHostSocket && !isOwner) return;
      room.shapes = room.shapes.filter((s) => s.id !== id);
      saveRooms();
    }
    socket.to(roomId).emit('undo', id);
  });

  // Clear: the host clears everything; anyone else only clears their own annotations.
  socket.on('clear', (roomId) => {
    const room = rooms[roomId];
    if (!room || currentRoom !== roomId) return;
    if (isHostSocket) {
      room.shapes = [];
      saveRooms();
      socket.to(roomId).emit('clear');
      return;
    }
    const mine = room.shapes.filter((s) => s.ownerId === clientIdForSocket);
    if (!mine.length) return;
    room.shapes = room.shapes.filter((s) => s.ownerId !== clientIdForSocket);
    saveRooms();
    for (const s of mine) socket.to(roomId).emit('delete-shape', s.id);
  });

  socket.on('update-shape', ({ roomId, id, changes }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!isValidChanges(changes)) return;
    const shape = room.shapes.find((s) => s.id === id);
    if (shape) {
      const isOwner = shape.ownerId === clientIdForSocket;
      if (!isHostSocket && !isOwner) return;
    }
    room.shapes = room.shapes.map((s) => (s.id === id ? { ...s, ...changes } : s));
    saveRooms();
    socket.to(roomId).emit('update-shape', { id, changes });
  });

  socket.on('change-page', ({ roomId, page }) => {
    const room = rooms[roomId];
    if (!room || !isHostSocket) return;
    room.currentPage = page;
    saveRooms();
    socket.to(roomId).emit('page-changed', page);
  });

  socket.on('scroll-sync', ({ roomId, ratio }) => {
    if (!rooms[roomId] || !isHostSocket) return;
    socket.to(roomId).emit('scroll-sync', ratio);
  });

  socket.on('metronome-update', ({ roomId, state }) => {
    if (!rooms[roomId] || !isHostSocket) return;
    socket.to(roomId).emit('metronome-update', state);
  });

  // Laser pointer — no storage, pure relay
  socket.on('laser-move', ({ roomId, x, y, page }) => {
    socket.to(roomId).emit('laser-move', { socketId: socket.id, x, y, page });
  });
  socket.on('laser-stop', (roomId) => {
    socket.to(roomId).emit('laser-stop', { socketId: socket.id });
  });

  // Raise / lower hand
  socket.on('raise-hand', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.raisedHands.includes(socket.id)) room.raisedHands.push(socket.id);
    io.to(roomId).emit('raise-hand', { socketId: socket.id, nickname: socketNames[socket.id] || 'Guest' });
  });
  socket.on('lower-hand', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    room.raisedHands = room.raisedHands.filter((id) => id !== socket.id);
    io.to(roomId).emit('lower-hand', { socketId: socket.id });
  });
  // Host dismisses a specific participant's raised hand
  socket.on('dismiss-hand', ({ roomId, socketId: targetId }) => {
    const room = rooms[roomId];
    if (!room || !isHostSocket) return;
    room.raisedHands = room.raisedHands.filter((id) => id !== targetId);
    io.to(roomId).emit('lower-hand', { socketId: targetId });
  });

  // Pitch detection — pure relay, never stored
  socket.on('pitch-update', ({ roomId, senderName, note, cents, freq, midi, timestamp }) => {
    if (!rooms[roomId]) return;
    if (typeof freq !== 'number' || typeof cents !== 'number') return;
    socket.to(roomId).emit('pitch-update', {
      senderId: socket.id,
      senderName: (senderName || 'Guest').slice(0, 64),
      note: String(note || '').slice(0, 8),
      cents: Math.round(Number(cents)),
      freq: Math.round(Number(freq) * 100) / 100,
      midi: typeof midi === 'number' ? midi : 0,
      timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
    });
  });

  socket.on('bookmark-add', ({ roomId, page }) => {
    if (!rooms[roomId] || typeof page !== 'number') return;
    socket.to(roomId).emit('bookmark-add', { page });
  });
  socket.on('bookmark-remove', ({ roomId, page }) => {
    if (!rooms[roomId] || typeof page !== 'number') return;
    socket.to(roomId).emit('bookmark-remove', { page });
  });

  socket.on('chat-message', ({ roomId, text, senderName }) => {
    const room = rooms[roomId];
    if (!room || typeof text !== 'string') return;
    const trimmed = text.trim().slice(0, 500);
    if (!trimmed) return;
    const message = {
      id: uuidv4(),
      senderId: socket.id,
      senderName: (socketNames[socket.id] || (senderName || 'Guest').trim() || 'Guest').slice(0, 64),
      text: trimmed,
      timestamp: new Date().toISOString(),
      isHost: isHostSocket,
    };
    if (!room.messages) room.messages = [];
    room.messages.push(message);
    if (room.messages.length > 100) room.messages.shift();
    io.to(roomId).emit('chat-message', message);
  });

  socket.on('leave-room', (roomId) => {
    socket.leave(roomId);
    if (currentRoom === roomId) currentRoom = null;
    const room = rooms[roomId];
    if (room) {
      room.raisedHands = room.raisedHands.filter((id) => id !== socket.id);
      room.hostSockets.delete(socket.id);
      if (room.hostSockets.size === 0) room.hostId = null;
      else room.hostId = [...room.hostSockets][0];
      socket.to(roomId).emit('laser-stop', { socketId: socket.id });
      socket.to(roomId).emit('lower-hand', { socketId: socket.id });
      socket.to(roomId).emit('member-left', { socketId: socket.id, clientId: clientIdForSocket });
      emitMemberCount(roomId);
    }
    delete socketNames[socket.id];
    delete socketClientId[socket.id];
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      room.raisedHands = room.raisedHands.filter((id) => id !== socket.id);
      room.hostSockets.delete(socket.id);
      if (room.hostSockets.size === 0) room.hostId = null;
      else room.hostId = [...room.hostSockets][0];
      socket.to(currentRoom).emit('laser-stop', { socketId: socket.id });
      socket.to(currentRoom).emit('lower-hand', { socketId: socket.id });
      socket.to(currentRoom).emit('member-left', { socketId: socket.id, clientId: clientIdForSocket });
      emitMemberCount(currentRoom);
    }
    delete socketNames[socket.id];
    delete socketClientId[socket.id];
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Allowed website(s): ${FRONTEND_ORIGINS.join(', ')}`);
  console.log(`Data folder: ${DATA_DIR} | uploads: ${UPLOADS_DIR} | OMR: ${OMR_ENABLED ? 'on' : 'off'}`);
});
