'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { v4: uuidv4 } = require('uuid');

// ← edit this before deploying
const CONTACT = 'your-email@example.com';
const USER_AGENT = `Unino/0.1 (contact: ${CONTACT})`;

// ── Cache (10-min TTL) ─────────────────────────────────────────────────────
const searchCache = {}; // normalized query → { results, expiresAt }

function getCached(query) {
  const entry = searchCache[query.toLowerCase().trim()];
  return entry && Date.now() < entry.expiresAt ? entry.results : null;
}
function setCache(query, results) {
  searchCache[query.toLowerCase().trim()] = { results, expiresAt: Date.now() + 10 * 60_000 };
}

// ── Server-wide IMSLP rate limit: 1 req/sec ───────────────────────────────
let lastImslpCallAt = 0;
async function acquireImslpSlot() {
  const wait = Math.max(0, 1000 - (Date.now() - lastImslpCallAt));
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastImslpCallAt = Date.now();
}

// ── Per-user rate limits ───────────────────────────────────────────────────
const searchBuckets = {};
const importBuckets = {};

function checkBucket(buckets, ip, limit, windowMs) {
  const now = Date.now();
  const b = buckets[ip];
  if (!b || now > b.resetAt) { buckets[ip] = { count: 1, resetAt: now + windowMs }; return true; }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}
const checkUserSearchLimit = (ip) => checkBucket(searchBuckets, ip, 5, 60_000);
const checkUserImportLimit = (ip) => checkBucket(importBuckets, ip, 3, 60_000);

// ── Search ─────────────────────────────────────────────────────────────────
function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('IMSLP request timed out')); });
  });
}

// Strip MediaWiki <span class='searchmatch'>...</span> from snippets
function cleanSnippet(html) {
  return (html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function searchIMSLP(query) {
  const cached = getCached(query);
  if (cached) return cached;

  // IMSLP's search needs every word to match, so a precise query like
  // "Cello Suite No. 1 in G Major" often finds nothing. Try several passes,
  // from strict to relaxed, then rank the merged hits by how well the title matches.
  const keywords = keywordQuery(query);
  const passes = [
    { q: query, what: 'title', limit: 10 },
    { q: keywords, what: 'title', limit: 30 },
    { q: keywords, what: 'text', limit: 20 },
  ];

  const byTitle = new Map();
  for (const pass of passes) {
    if (!pass.q) continue;
    const hits = await runSearch(pass.q, pass.what, pass.limit);
    for (const hit of hits) {
      // Many short titles are redirects; show the real work page instead
      const redirect = /#REDIRECT\s*\[\[([^\]]+)\]\]/i.exec(cleanSnippet(hit.snippet).replace(/\s+/g, ' '));
      const title = redirect ? redirect[1].trim() : hit.title || '';
      if (!title || byTitle.has(title)) continue;
      byTitle.set(title, {
        title,
        description: redirect ? `Includes: ${hit.title}` : cleanSnippet(hit.snippet),
        score: titleScore(hit.title || '', query),
      });
    }
    if (byTitle.size >= 10) break;
  }

  const results = [...byTitle.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ title, description }) => ({
      title,
      description,
      url: `https://imslp.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    }));

  setCache(query, results);
  return results;
}

async function runSearch(q, what, limit) {
  await acquireImslpSlot();
  const params = new URLSearchParams({
    action: 'query', list: 'search', srsearch: q, srwhat: what, srlimit: String(limit), format: 'json',
  });
  // The trailing "&*" avoids IMSLP's "Security redirect" page for queries like "No.1"
  const { status, body } = await httpsGetText(`https://imslp.org/api.php?${params}&*`);
  if (status !== 200) throw new Error(`IMSLP returned HTTP ${status}`);
  try {
    return JSON.parse(body)?.query?.search || [];
  } catch {
    return [];
  }
}

const NOISE_WORDS = new Set([
  'in', 'no', 'nr', 'op', 'opus', 'the', 'of', 'and', 'for', 'a', 'major', 'minor', 'dur', 'moll',
  'flat', 'sharp', 'bwv', 'k', 'kv', 'hob', 'd', 'c', 'e', 'f', 'g', 'b',
]);

function tokens(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean);
}

// Keep only the meaningful words: "Cello Suite No. 1 in G Major" -> "cello suite"
function keywordQuery(query) {
  return tokens(query).filter(t => !NOISE_WORDS.has(t) && !/^\d+$/.test(t)).join(' ');
}

// Count how many query words (numbers and keys included) appear in the title
function titleScore(title, query) {
  const titleWords = new Set(tokens(title));
  return tokens(query).reduce((n, t) => {
    if (titleWords.has(t)) return n + (/^\d+$/.test(t) ? 2 : 1);
    if (titleWords.has(t + 's') || titleWords.has(t.replace(/s$/, ''))) return n + 0.8;
    return n;
  }, 0);
}

// ── SSRF / host allowlist ──────────────────────────────────────────────────
function isAllowedHost(hostname) {
  // Allow imslp.org and all official subdomains (CDN: s1–s9.imslp.org, etc.)
  if (hostname === 'imslp.org' || hostname.endsWith('.imslp.org')) return true;
  if (hostname === 'imslp.eu' || hostname.endsWith('.imslp.eu')) return true;
  if (hostname === 'imslps.org' || hostname.endsWith('.imslps.org')) return true;
  // IMSLP image CDN
  if (hostname === 'dn.imagefromindex.org' || hostname.endsWith('.imagefromindex.org')) return true;
  return false;
}

function isPrivateIP(ip) {
  if (ip === '::1' || ip === 'localhost') return true;
  const stripped = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const p = stripped.split('.').map(Number);
  if (p.length !== 4) return true; // IPv6: block non-mapped
  if (p[0] === 127 || p[0] === 0) return true;
  if (p[0] === 10) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  return false;
}

async function validateHost(hostname) {
  if (!isAllowedHost(hostname)) {
    throw Object.assign(
      new Error(`Host '${hostname}' is not in the IMSLP allow-list`),
      { code: 'HOST_NOT_ALLOWED' },
    );
  }
  let addrs = [];
  try { addrs = await dns.resolve4(hostname); } catch {}
  for (const addr of addrs) {
    if (isPrivateIP(addr)) throw Object.assign(new Error('Host resolves to a private IP'), { code: 'PRIVATE_IP' });
  }
}

// ── Manual-redirect HTTPS fetch with SSRF check at each hop ───────────────
async function fetchWithRedirectCheck(startUrl, maxRedirects = 3, extraHeaders = {}) {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!currentUrl.startsWith('https://')) {
      throw Object.assign(new Error('Only HTTPS URLs are accepted'), { code: 'NO_HTTPS' });
    }
    const parsed = new URL(currentUrl);
    await validateHost(parsed.hostname);

    const res = await new Promise((resolve, reject) => {
      const req = https.get(currentUrl, { headers: { 'User-Agent': USER_AGENT, ...extraHeaders } }, resolve);
      req.on('error', reject);
      req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Request timed out')); });
    });

    if (res.statusCode >= 300 && res.statusCode < 400) {
      const location = res.headers.location;
      res.resume(); // drain body before next hop
      if (!location) throw new Error('Redirect with no Location header');
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    return { res, finalUrl: currentUrl };
  }
  throw new Error('Too many redirects (max 3)');
}

// ── Import: download PDF from IMSLP ───────────────────────────────────────
const DISCLAIMER_COOKIE = 'imslpdisclaimeraccepted=yes';
const MAX_PDF_BYTES = 200 * 1024 * 1024; // 200 MB (same as uploads)

async function importFromUrl(fileUrl, uploadsDir) {
  if (typeof fileUrl !== 'string' || !fileUrl.trim()) {
    throw Object.assign(new Error('No URL provided'), { code: 'NO_URL' });
  }
  if (!fileUrl.startsWith('https://')) {
    throw Object.assign(new Error('Only HTTPS URLs are accepted'), { code: 'NO_HTTPS' });
  }

  const { res, finalUrl } = await fetchWithRedirectCheck(fileUrl, 3, { Cookie: DISCLAIMER_COOKIE });

  // Handle error status codes
  if (res.statusCode === 404) {
    res.resume();
    throw Object.assign(new Error('File not found on IMSLP (404). The link may be outdated.'), { code: 'NOT_FOUND' });
  }
  if (res.statusCode === 403) {
    res.resume();
    throw Object.assign(new Error('IMSLP denied access (403). Try logging in on IMSLP first.'), { code: 'FORBIDDEN' });
  }
  if (res.statusCode !== 200) {
    res.resume();
    throw Object.assign(new Error(`IMSLP returned HTTP ${res.statusCode}`), { code: 'BAD_STATUS' });
  }

  const contentType = (res.headers['content-type'] || '').toLowerCase();

  if (contentType.includes('text/html')) {
    res.resume();
    throw Object.assign(
      new Error(
        'IMSLP returned an HTML page instead of a PDF. ' +
        'This is a disclaimer or waiting-room page. ' +
        'Please open the IMSLP page in your browser, wait for the timer, download the PDF, then upload it here.',
      ),
      { code: 'IMSLP_HTML_PAGE', finalUrl },
    );
  }

  if (contentType.includes('zip') || contentType.includes('x-zip') || finalUrl.endsWith('.zip')) {
    res.resume();
    throw Object.assign(
      new Error(
        'IMSLP served a ZIP archive (multiple files bundled together). ' +
        'Please download it from IMSLP, unzip it, and upload the individual PDF.',
      ),
      { code: 'IS_ZIP', finalUrl },
    );
  }

  if (!contentType.includes('pdf') && !contentType.includes('octet-stream') && !contentType.includes('force-download')) {
    res.resume();
    throw Object.assign(
      new Error(`Unexpected file type from IMSLP: ${contentType}. Only PDFs are supported.`),
      { code: 'BAD_CONTENT_TYPE' },
    );
  }

  const filename = `${uuidv4()}.pdf`;
  const dest = path.join(uploadsDir, filename);

  return new Promise((resolve, reject) => {
    let size = 0;
    let aborted = false;
    const ws = fs.createWriteStream(dest);

    function abort(err) {
      if (aborted) return;
      aborted = true;
      res.destroy();
      ws.destroy();
      fs.unlink(dest, () => {});
      reject(err);
    }

    res.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_PDF_BYTES) {
        abort(Object.assign(new Error('File exceeds the 200 MB limit'), { code: 'TOO_LARGE' }));
        return;
      }
      if (!ws.write(chunk)) res.pause();
    });

    ws.on('drain', () => { if (!aborted) res.resume(); });
    res.on('end',  () => { if (!aborted) ws.end(); });
    ws.on('finish', () => { if (!aborted) resolve({ filename, finalUrl, size }); });
    res.on('error', abort);
    ws.on('error', abort);
  });
}

module.exports = { searchIMSLP, importFromUrl, checkUserSearchLimit, checkUserImportLimit };
