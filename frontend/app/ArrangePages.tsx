'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { useT, type TFunc } from '../lib/i18n';
import { backendUrl } from '../lib/config';

// Host tool: rearrange this room's score (reorder / remove pages, add pages from other PDFs)
// and set a play order for repeats. Rearranging builds a new PDF in the browser, uploads it,
// and the server moves every annotation along with its page.

interface Source { id: string; name: string; url?: string; file?: File }
interface Item { key: string; src: string; page: number }

const THUMB_W = 96;

export default function ArrangePages({ pdfUrl, scoreName, numPages, playOrder, onApply, onSetPlayOrder, onClose }: {
  pdfUrl: string;
  scoreName: string;
  numPages: number;
  playOrder: number[] | null;
  onApply: (newPdfUrl: string, pageMap: number[], pageCount: number) => void;
  onSetPlayOrder: (order: number[] | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<'pages' | 'order'>('pages');
  const initialItems = useMemo<Item[]>(
    () => Array.from({ length: numPages }, (_, i) => ({ key: `orig:${i}`, src: 'orig', page: i })), [numPages]);
  const [sources, setSources] = useState<Source[]>([{ id: 'orig', name: scoreName, url: pdfUrl }]);
  const [items, setItems] = useState<Item[]>(initialItems);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const changed = items.length !== initialItems.length || items.some((it, i) => it.key !== initialItems[i].key);

  // Render small page images for every source (one page at a time, so big scores stay responsive).
  const rendered = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      if (cancelled) return;
      for (const src of sources) {
        if (rendered.current.has(src.id)) continue;
        rendered.current.add(src.id);
        const data = src.file ? new Uint8Array(await src.file.arrayBuffer()) : undefined;
        const doc = await pdfjsLib.getDocument(data ? { data, wasmUrl: '/' } : { url: src.url!, wasmUrl: '/' }).promise;
        if (cancelled) { rendered.current.delete(src.id); return; }
        for (let i = 0; i < doc.numPages; i++) {
          // Stopped early (dialog closed, or React re-ran the effect): allow this source to render again later.
          if (cancelled) { rendered.current.delete(src.id); return; }
          const pg = await doc.getPage(i + 1);
          const vp1 = pg.getViewport({ scale: 1 });
          const vp = pg.getViewport({ scale: THUMB_W / vp1.width });
          const c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c }).promise;
          const url = c.toDataURL('image/jpeg', 0.7);
          if (!cancelled) setThumbs(prev => ({ ...prev, [`${src.id}:${i}`]: url }));
        }
      }
    })().catch(err => console.warn('Thumbnail error:', err));
    return () => { cancelled = true; };
  }, [sources]);

  function move(key: string, to: number) {
    setItems(prev => {
      const from = prev.findIndex(it => it.key === key);
      if (from < 0) return prev;
      const next = prev.slice();
      const [it] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, to)), 0, it);
      return next;
    });
  }

  async function addPdfs(files: FileList | null) {
    if (!files) return;
    setError('');
    for (const file of Array.from(files)) {
      if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) continue;
      try {
        const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
        const id = `add${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
        setSources(prev => [...prev, { id, name: file.name.replace(/\.pdf$/i, ''), file }]);
        setItems(prev => [...prev, ...Array.from({ length: doc.getPageCount() }, (_, i) => ({ key: `${id}:${i}`, src: id, page: i }))]);
      } catch {
        setError(t('Could not read “{name}”. Is it a PDF?', { name: file.name }));
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function apply() {
    if (items.length === 0) { setError(t('Keep at least one page.')); return; }
    setBusy(true); setError('');
    try {
      const out = await PDFDocument.create();
      const loaded: Record<string, PDFDocument> = {};
      for (const src of sources) {
        if (!items.some(it => it.src === src.id)) continue;
        const bytes = src.file ? await src.file.arrayBuffer() : await (await fetch(src.url!)).arrayBuffer();
        loaded[src.id] = await PDFDocument.load(bytes, { ignoreEncryption: true });
      }
      for (const it of items) {
        const [pg] = await out.copyPages(loaded[it.src], [it.page]);
        out.addPage(pg);
      }
      const blob = new Blob([await out.save() as BlobPart], { type: 'application/pdf' });
      if (blob.size > 200 * 1024 * 1024) throw new Error('This PDF is larger than 200 MB. Try a smaller file.');
      const form = new FormData();
      form.append('pdf', new File([blob], `${scoreName || 'score'}.pdf`, { type: 'application/pdf' }));
      const res = await fetch(backendUrl('/upload'), { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || 'Upload failed. Try again.');
      // Where each original page ended up (first copy), or -1 if removed.
      const pageMap = Array.from({ length: numPages }, (_, p) => items.findIndex(it => it.src === 'orig' && it.page === p));
      onApply(body.url, pageMap, items.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the new page order.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-label={t('Arrange pages')}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative w-full max-w-3xl max-h-full flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--modal-bg)', border: '1px solid var(--border-md)', color: 'var(--t)' }}>
        <div className="flex items-center gap-1 px-4 pt-3 shrink-0" style={{ borderBottom: '1px solid var(--divider)' }}>
          {(['pages', 'order'] as const).map(k => (
            <button key={k} onClick={() => setTab(k)}
              className="px-3 pb-2.5 text-sm font-medium border-b-2 transition-colors"
              style={{ borderColor: tab === k ? '#6366f1' : 'transparent', color: tab === k ? 'var(--t)' : 'var(--t3)' }}>
              {k === 'pages' ? t('Arrange pages') : t('Play order')}
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={onClose} disabled={busy} aria-label={t('Close')} className="w-8 h-8 mb-2 rounded-lg flex items-center justify-center hover:bg-black/[0.05]" style={{ color: 'var(--t3)' }}>✕</button>
        </div>

        {tab === 'pages' ? (
          <>
            <p className="px-4 pt-3 text-xs shrink-0" style={{ color: 'var(--t3)' }}>
              {t('Drag pages to reorder, or use the arrows. Annotations move with their pages. Everyone in the room sees the new order.')}
            </p>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_W + 16}px, 1fr))` }}>
                {items.map((it, idx) => {
                  const src = sources.find(s => s.id === it.src);
                  return (
                    <div key={it.key} draggable
                      onDragStart={() => setDragKey(it.key)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => { if (dragKey) move(dragKey, idx); setDragKey(null); }}
                      className="flex flex-col items-center gap-1 p-2 rounded-xl"
                      style={{ background: dragKey === it.key ? 'rgba(99,102,241,0.12)' : 'var(--surface)', border: '1px solid var(--border)', cursor: 'grab' }}>
                      <div className="relative bg-white rounded shadow-sm flex items-center justify-center" style={{ width: THUMB_W, minHeight: THUMB_W * 1.3 }}>
                        {thumbs[it.key]
                          // eslint-disable-next-line @next/next/no-img-element -- local data URL thumbnail
                          ? <img src={thumbs[it.key]} alt="" style={{ width: THUMB_W, display: 'block' }} draggable={false} />
                          : <span className="text-[10px] text-gray-400">…</span>}
                        <span className="absolute top-1 left-1 text-[10px] font-semibold px-1.5 rounded bg-black/60 text-white">{idx + 1}</span>
                      </div>
                      <span className="text-[10px] truncate w-full text-center" style={{ color: 'var(--t3)' }} title={src?.name}>
                        {it.src === 'orig' ? t('Page {n}', { n: it.page + 1 }) : `${src?.name ?? ''} · ${it.page + 1}`}
                      </span>
                      <div className="flex gap-1">
                        <button onClick={() => move(it.key, idx - 1)} disabled={idx === 0} aria-label={t('Move earlier')}
                          className="w-7 h-7 rounded-md text-xs disabled:opacity-25 hover:bg-black/[0.06]" style={{ color: 'var(--t2)' }}>◀</button>
                        <button onClick={() => setItems(prev => prev.filter(x => x.key !== it.key))} aria-label={t('Remove page')}
                          className="w-7 h-7 rounded-md text-xs hover:bg-red-500/10" style={{ color: '#ef4444' }}>✕</button>
                        <button onClick={() => move(it.key, idx + 1)} disabled={idx === items.length - 1} aria-label={t('Move later')}
                          className="w-7 h-7 rounded-md text-xs disabled:opacity-25 hover:bg-black/[0.06]" style={{ color: 'var(--t2)' }}>▶</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--divider)' }}>
              <label className="px-3 py-2 text-sm rounded-lg cursor-pointer font-medium" style={{ border: '1px solid var(--border-md)', color: 'var(--t2)' }}>
                {t('+ Add pages from another PDF')}
                <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple className="hidden" onChange={e => addPdfs(e.target.files)} />
              </label>
              {changed && (
                <button onClick={() => { setItems(initialItems); setError(''); }} disabled={busy}
                  className="px-3 py-2 text-sm rounded-lg" style={{ color: 'var(--t3)' }}>{t('Undo changes')}</button>
              )}
              <div className="flex-1" />
              {error && <span role="alert" className="text-xs" style={{ color: '#ef4444' }}>{t(error)}</span>}
              <span className="text-xs" style={{ color: 'var(--t3)' }}>{t('{n} pages', { n: items.length })}</span>
              <button onClick={apply} disabled={!changed || busy}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-40">
                {busy ? t('Saving…') : t('Save new order')}
              </button>
            </div>
          </>
        ) : (
          <PlayOrderTab numPages={numPages} playOrder={playOrder} onSet={onSetPlayOrder} t={t} />
        )}
      </div>
    </div>
  );
}

// "1-4, 1-2, 5" → [0,1,2,3,0,1,4] (0-based). Returns null with a message if something is wrong.
export function parsePlayOrder(text: string, numPages: number): { order: number[] | null; error: string } {
  const order: number[] = [];
  for (const raw of text.split(/[,，\s]+/).filter(Boolean)) {
    const m = raw.match(/^(\d+)(?:[-–~](\d+))?$/);
    if (!m) return { order: null, error: `“${raw}”` };
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b < 1 || a > numPages || b > numPages) return { order: null, error: `“${raw}”` };
    const step = a <= b ? 1 : -1;
    for (let p = a; p !== b + step; p += step) order.push(p - 1);
  }
  return order.length ? { order, error: '' } : { order: null, error: '' };
}

// Turn [0,1,2,3,0,1,4] back into "1-4, 1-2, 5".
export function formatPlayOrder(order: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1] === order[j] + 1) j++;
    parts.push(j > i ? `${order[i] + 1}-${order[j] + 1}` : `${order[i] + 1}`);
    i = j + 1;
  }
  return parts.join(', ');
}

function PlayOrderTab({ numPages, playOrder, onSet, t }: {
  numPages: number; playOrder: number[] | null; onSet: (o: number[] | null) => void; t: TFunc;
}) {
  const [text, setText] = useState(playOrder ? formatPlayOrder(playOrder) : '');
  const parsed = parsePlayOrder(text, numPages);
  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto">
      <p className="text-sm" style={{ color: 'var(--t2)' }}>
        {t('For repeats (D.C. / D.S.): list pages in the order they are played. The page arrows then follow this order for everyone. The PDF itself does not change.')}
      </p>
      <label className="text-xs font-medium" style={{ color: 'var(--t3)' }}>{t('Pages in play order')}</label>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="1-4, 1-2, 5-6"
        className="u-input rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none" />
      <p className="text-xs" style={{ color: 'var(--t3)' }}>
        {t('Example: “1-4, 1-2, 5-6” plays pages 1 to 4, goes back to 1–2, then continues with 5 and 6. This score has {n} pages.', { n: numPages })}
      </p>
      {parsed.error && <p role="alert" className="text-xs" style={{ color: '#ef4444' }}>{t('Check this part: {part}', { part: parsed.error })}</p>}
      {parsed.order && (
        <div className="flex flex-wrap gap-1.5">
          {parsed.order.map((p, i) => (
            <span key={i} className="text-xs font-semibold px-2 py-1 rounded-md" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>{p + 1}</span>
          ))}
        </div>
      )}
      <div className="flex gap-2 justify-end mt-2">
        {playOrder && (
          <button onClick={() => { onSet(null); setText(''); }} className="px-3 py-2 text-sm rounded-lg" style={{ color: '#ef4444' }}>
            {t('Turn off play order')}
          </button>
        )}
        <button onClick={() => parsed.order && onSet(parsed.order)} disabled={!parsed.order}
          className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-40">
          {t('Use this order')}
        </button>
      </div>
    </div>
  );
}
