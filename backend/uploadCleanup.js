// Cleanup of uploaded PDFs that no room uses any more.
//
// Rule:
// 1. A PDF that any room references is never touched (checked again right before every move/delete).
// 2. The first time a PDF is seen with no room using it, that time is recorded. If a room uses it
//    again, the record is removed (the clock resets).
// 3. After UNUSED_DAYS (7) unused, the PDF moves to uploads/_trash/ (its OMR cache goes with it).
// 4. After TRASH_DAYS (7) more in the trash, it is deleted for good.
// 5. Every move and deletion is logged with the file name, to the console and to a log file.

const fs = require('fs');
const path = require('path');

const DAY = 24 * 60 * 60 * 1000;
const UNUSED_DAYS = 7;
const TRASH_DAYS = 7;
const PDF_NAME = /^[\w-]+\.pdf$/i;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Move a file or folder, also across disks (rename fails between volumes).
function move(from, to) {
  try { fs.renameSync(from, to); }
  catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/**
 * Run one cleanup pass.
 * @param {object} o
 * @param {string} o.uploadsDir  folder with the uploaded PDFs
 * @param {string} o.omrDir      folder with OMR caches (<stem>/), may not exist
 * @param {string} o.stateFile   JSON file that remembers unused/trash times
 * @param {string} o.logFile     log file (one line per move/deletion)
 * @param {() => Set<string>} o.referencedNames  file names (e.g. "abc.pdf") that rooms use right now
 * @param {number} [o.now]       current time in ms (tests pass a fake one)
 * @returns {{moved: string[], deleted: string[], restored: string[]}}
 */
function sweepUploads({ uploadsDir, omrDir, stateFile, logFile, referencedNames, now = Date.now() }) {
  const trashDir = path.join(uploadsDir, '_trash');
  const state = readJson(stateFile, { unusedSince: {}, trashedAt: {} });
  state.unusedSince ||= {};
  state.trashedAt ||= {};
  const result = { moved: [], deleted: [], restored: [] };
  const stamp = new Date(now).toISOString();

  const log = (msg) => {
    const line = `${stamp} ${msg}`;
    console.log(`[upload-cleanup] ${line}`);
    try { fs.appendFileSync(logFile, line + '\n'); } catch (err) { console.error('[upload-cleanup] could not write log:', err.message); }
  };

  // 1. Uploaded PDFs: start, keep or reset the unused clock; move old ones to the trash.
  let files = [];
  try { files = fs.readdirSync(uploadsDir).filter((n) => PDF_NAME.test(n)); } catch {}
  const used = referencedNames();
  for (const name of files) {
    if (used.has(name)) {
      if (state.unusedSince[name]) delete state.unusedSince[name]; // in use again: reset
      continue;
    }
    const since = state.unusedSince[name];
    if (!since) { state.unusedSince[name] = stamp; continue; }
    if (now - Date.parse(since) < UNUSED_DAYS * DAY) continue;

    // Check again right before touching it.
    if (referencedNames().has(name)) { delete state.unusedSince[name]; continue; }
    try {
      fs.mkdirSync(trashDir, { recursive: true });
      move(path.join(uploadsDir, name), path.join(trashDir, name));
      const stem = name.replace(/\.pdf$/i, '');
      const omr = path.join(omrDir, stem);
      if (fs.existsSync(omr)) move(omr, path.join(trashDir, `${stem}.omr`));
      delete state.unusedSince[name];
      state.trashedAt[name] = stamp;
      result.moved.push(name);
      log(`MOVED to trash: ${name} (unused since ${since})`);
    } catch (err) {
      log(`ERROR moving ${name} to trash: ${err.message}`);
    }
  }
  // Forget records for files that are no longer in uploads (deleted or moved by hand).
  for (const name of Object.keys(state.unusedSince)) {
    if (!files.includes(name)) delete state.unusedSince[name];
  }

  // 2. Trash: delete for good after TRASH_DAYS. A file a room needs again is put back instead.
  let trashed = [];
  try { trashed = fs.readdirSync(trashDir).filter((n) => PDF_NAME.test(n)); } catch {}
  for (const name of trashed) {
    const stem = name.replace(/\.pdf$/i, '');
    if (referencedNames().has(name)) {
      try {
        if (!fs.existsSync(path.join(uploadsDir, name))) {
          move(path.join(trashDir, name), path.join(uploadsDir, name));
          const omrTrash = path.join(trashDir, `${stem}.omr`);
          if (fs.existsSync(omrTrash) && !fs.existsSync(path.join(omrDir, stem))) move(omrTrash, path.join(omrDir, stem));
          result.restored.push(name);
          log(`RESTORED from trash (a room uses it): ${name}`);
        }
      } catch (err) { log(`ERROR restoring ${name}: ${err.message}`); }
      delete state.trashedAt[name];
      continue;
    }
    if (!state.trashedAt[name]) { state.trashedAt[name] = stamp; continue; } // put there by hand: start its clock
    if (now - Date.parse(state.trashedAt[name]) < TRASH_DAYS * DAY) continue;
    try {
      fs.rmSync(path.join(trashDir, name), { force: true });
      fs.rmSync(path.join(trashDir, `${stem}.omr`), { recursive: true, force: true });
      log(`DELETED for good: ${name} (in trash since ${state.trashedAt[name]})`);
      delete state.trashedAt[name];
      result.deleted.push(name);
    } catch (err) {
      log(`ERROR deleting ${name}: ${err.message}`);
    }
  }
  for (const name of Object.keys(state.trashedAt)) {
    if (!trashed.includes(name)) delete state.trashedAt[name];
  }

  try { writeJsonAtomic(stateFile, state); } catch (err) { console.error('[upload-cleanup] could not save state:', err.message); }
  return result;
}

module.exports = { sweepUploads, UNUSED_DAYS, TRASH_DAYS };
