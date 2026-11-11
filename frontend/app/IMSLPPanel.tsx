'use client';

import { useState, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface SearchResult {
  title: string;
  description: string;
  url: string;
}

interface ImportResult {
  roomId: string;
  hostToken: string;
  pdfUrl: string;
  scoreName: string;
  imslpPageUrl?: string;
}

interface Props {
  clientId: string;
  user: User | null;
  onImportSuccess: (data: ImportResult) => void;
}

export default function IMSLPPanel({ clientId, user, onImportSuccess }: Props) {
  // ── Search state ───────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Import state ───────────────────────────────────────────────────────
  const [importUrl, setImportUrl] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<{
    message: string;
    code?: string;
    fallbackUrl?: string;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      let res: Response;
      try {
        res = await fetch(`http://localhost:3001/imslp/search?q=${encodeURIComponent(q)}`);
      } catch {
        setSearchError('Could not reach our server. Check your connection.');
        return;
      }

      // Safe JSON parse — backend may return plain-text on unexpected errors
      let data: { results?: SearchResult[]; message?: string; error?: string } = {};
      try { data = await res.json(); } catch {}

      if (res.status === 429) {
        setSearchError('Too many requests — please wait a moment and try again.');
        return;
      }
      if (res.status === 502 || res.status === 504) {
        setSearchError('Could not reach IMSLP. It may be temporarily unavailable.');
        return;
      }
      if (!res.ok) {
        setSearchError(data.message || 'Could not search IMSLP.');
        return;
      }

      const list: SearchResult[] = data.results || [];
      setResults(list);
      if (list.length === 0) setSearchError('No results found on IMSLP for this query.');
    } finally {
      setSearching(false);
    }
  }

  async function handleImport() {
    const url = importUrl.trim();
    if (!url || !confirmed || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      let supabaseToken: string | null = null;
      if (user) {
        try { const { data } = await supabase.auth.getSession(); supabaseToken = data.session?.access_token ?? null; } catch {}
      }

      let res: Response;
      try {
        res = await fetch('http://localhost:3001/imslp/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl: url, clientId, supabaseToken }),
        });
      } catch {
        setImportError({ message: 'Could not reach our server. Check your connection.' });
        return;
      }

      let data: { message?: string; error?: string; finalUrl?: string } & Partial<ImportResult> = {};
      try { data = await res.json(); } catch {}

      if (res.status === 429) {
        setImportError({ message: 'Too many imports — please wait a minute and try again.' });
        return;
      }
      if (res.status === 502 || res.status === 504) {
        setImportError({ message: 'Could not reach IMSLP. It may be temporarily unavailable.' });
        return;
      }
      if (!res.ok) {
        setImportError({ message: data.message || 'Import failed.', code: data.error, fallbackUrl: data.finalUrl });
        return;
      }
      onImportSuccess(data as ImportResult);
    } finally {
      setImporting(false);
    }
  }

  const looksLikeImslpUrl = /imslp\.(org|eu)|imagefromindex\.org/i.test(importUrl);
  const showDisclaimer = importUrl.trim().startsWith('https://') && looksLikeImslpUrl;

  return (
    <div style={{ width: '100%', maxWidth: 672, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Search card ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 36, height: 36, borderRadius: 'var(--r-sm)', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, color: '#fbbf24' }}>
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </div>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--t)', margin: 0, lineHeight: 1.2 }}>Find on IMSLP</h2>
            <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0, marginTop: 2 }}>
              Free public domain sheet music
            </p>
          </div>
        </div>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSearchError(null); if (!e.target.value) setResults(null); }}
            placeholder='e.g. "Popper Op. 76" or "Bach cello suite"'
            style={{
              flex: 1, padding: '9px 14px', fontSize: 13, borderRadius: 'var(--r-md)',
              background: 'var(--input-bg, rgba(255,255,255,0.05))',
              border: '1px solid var(--border)', color: 'var(--t)',
              outline: 'none',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          />
          <button
            type="submit"
            disabled={!query.trim() || searching}
            style={{
              padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 'var(--r-md)',
              border: 'none', cursor: searching || !query.trim() ? 'not-allowed' : 'pointer',
              background: 'rgba(251,191,36,0.15)', color: '#fbbf24', flexShrink: 0,
              opacity: searching || !query.trim() ? 0.5 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {searchError && (
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--t3)', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
            {searchError}
          </p>
        )}

        {results !== null && results.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
            {results.map((r, i) => (
              <div key={i} style={{
                padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--app-bg)',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t)', margin: 0, lineHeight: 1.3, wordBreak: 'break-word' }}>{r.title}</p>
                  {r.description && (
                    <p style={{ fontSize: 11, color: 'var(--t3)', margin: '3px 0 0', lineHeight: 1.4 }}>{r.description}</p>
                  )}
                </div>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7,
                    border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24',
                    textDecoration: 'none', background: 'rgba(251,191,36,0.07)',
                    display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                  }}
                >
                  Open on IMSLP
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10 }}>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              </div>
            ))}
            <p style={{ fontSize: 10, color: 'var(--t3)', textAlign: 'center', marginTop: 4 }}>
              Results from <a href="https://imslp.org" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>IMSLP</a>. Copyright depends on your country — check the page before downloading.
            </p>
          </div>
        )}
      </div>

      {/* ── Import card ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18 }}>
          <div style={{ width: 36, height: 36, borderRadius: 'var(--r-sm)', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, color: '#818cf8' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--t)', margin: 0, lineHeight: 1.2 }}>Import from IMSLP link</h2>
            <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0, marginTop: 2 }}>
              Paste a direct PDF link from an IMSLP score page
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="url"
            value={importUrl}
            onChange={e => { setImportUrl(e.target.value); setImportError(null); setConfirmed(false); }}
            placeholder="https://imslp.org/wiki/Special:ImagefromIndex/…"
            style={{
              width: '100%', padding: '9px 14px', fontSize: 13, borderRadius: 'var(--r-md)',
              background: 'var(--input-bg, rgba(255,255,255,0.05))',
              border: '1px solid var(--border)', color: 'var(--t)',
              outline: 'none', boxSizing: 'border-box',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          />

          {showDisclaimer && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
                style={{ marginTop: 2, flexShrink: 0, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>
                This score is from IMSLP. Copyright depends on my country.{' '}
                <strong>I confirm I may use this score in my country.</strong>
              </span>
            </label>
          )}

          {importError && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)', fontSize: 12, color: 'var(--t2)',
            }}>
              <p style={{ margin: 0, lineHeight: 1.5 }}>{importError.message}</p>
              {importError.fallbackUrl && (
                <a
                  href={importError.fallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 11, fontWeight: 600, color: '#818cf8', textDecoration: 'none' }}
                >
                  Open file page on IMSLP to download manually
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10 }}>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              )}
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={!importUrl.trim() || !confirmed || importing}
            style={{
              padding: '10px 0', fontSize: 13, fontWeight: 600, borderRadius: 'var(--r-md)',
              border: 'none', cursor: (!importUrl.trim() || !confirmed || importing) ? 'not-allowed' : 'pointer',
              background: 'rgba(99,102,241,0.18)', color: '#818cf8',
              opacity: (!importUrl.trim() || !confirmed || importing) ? 0.45 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {importing ? 'Importing…' : 'Import & Open'}
          </button>

          <p style={{ fontSize: 10, color: 'var(--t3)', margin: 0, lineHeight: 1.5 }}>
            Only IMSLP-hosted files are accepted. The PDF is downloaded via our server.
            IMSLP may serve a waiting page — if so, download the file manually and use &ldquo;Start a session&rdquo; above.
          </p>
        </div>
      </div>
    </div>
  );
}
