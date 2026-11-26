'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Glyph from './Glyph';
import { useT } from '../lib/i18n';
import { backendUrl, resolvePdfUrl } from '../lib/config';
import { getHostTokens } from '../lib/library';
import { supabase } from '../lib/supabase';
import { SYMBOL_DEFS, SYMBOL_LABELS, type SymbolId } from './symbols';

// Technique library: every vibrato / slide mark from earlier lessons, across all your scores.
// Each example shows the bar around the mark; the teacher can record a short demo clip on it.
export interface TechniqueItem {
  roomId: string; shapeId: string; symbolId: SymbolId; page: number;
  x: number; y: number; w: number; h: number;
  scoreName: string; studentTag: string; pdfUrl: string; lastActive: string | null;
  clipUrl: string | null;
}

const TECHNIQUES: SymbolId[] = ['vibrato', 'slideUp', 'slideDown'];

async function supaToken() {
  try { const { data } = await supabase.auth.getSession(); return data.session?.access_token ?? null; } catch { return null; }
}

// One loaded PDF per score, shared by all cards.
const docs = new Map<string, Promise<any>>();
function loadDoc(url: string) {
  if (!docs.has(url)) {
    docs.set(url, (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return pdfjsLib.getDocument({ url, wasmUrl: '/' }).promise;
    })());
  }
  return docs.get(url)!;
}

// A strip of the page around the mark (full width, about one staff line high).
function BarPicture({ item }: { item: TechniqueItem }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      const url = resolvePdfUrl(item.pdfUrl);
      if (!url || !ref.current) return;
      try {
        const doc = await loadDoc(url);
        const page = await doc.getPage(item.page + 1);
        const base = page.getViewport({ scale: 1 });
        const scale = 900 / base.width;
        const vp = page.getViewport({ scale });
        const full = document.createElement('canvas');
        full.width = vp.width; full.height = vp.height;
        await page.render({ canvas: full, canvasContext: full.getContext('2d')!, viewport: vp }).promise;
        if (off || !ref.current) return;
        const cy = item.y + (item.h || 0) / 2;
        const top = Math.max(0, cy - 0.07), bottom = Math.min(1, cy + 0.07);
        const c = ref.current;
        c.width = vp.width; c.height = (bottom - top) * vp.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(full, 0, top * vp.height, vp.width, c.height, 0, 0, c.width, c.height);
        // Ring the mark so it is easy to spot.
        ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3;
        const pad = 10;
        ctx.strokeRect(item.x * vp.width - pad, (item.y - top) * vp.height - pad,
          (item.w || 0.03) * vp.width + pad * 2, (item.h || 0.02) * vp.height + pad * 2);
      } catch {}
    })();
    return () => { off = true; };
  }, [item]);
  return <canvas ref={ref} className="w-full rounded-lg bg-white" style={{ minHeight: 60 }} />;
}

function SymbolIcon({ id }: { id: SymbolId }) {
  const d = SYMBOL_DEFS[id];
  return (
    <svg viewBox={`${d.bx - 20} ${d.by - 20} ${d.bw + 40} ${d.bh + 40}`} style={{ width: 22, height: 16 }}>
      <path d={d.d} fill={d.fill ? 'currentColor' : 'none'} stroke={d.fill ? 'none' : 'currentColor'} strokeWidth={d.fill ? 0 : 40} strokeLinecap="round" />
    </svg>
  );
}

// Record a demo with the camera (or microphone only), then upload it to the mark.
function DemoRecorder({ item, onSaved }: { item: TechniqueItem; onSaved: (url: string) => void }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'rec' | 'saving'>('idle');
  const [err, setErr] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const preview = useRef<HTMLVideoElement>(null);

  async function start(video: boolean) {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr(t('Recording needs a secure (https) page.')); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      if (preview.current && video) { preview.current.srcObject = stream; preview.current.play().catch(() => {}); }
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach(tr => tr.stop());
        if (preview.current) preview.current.srcObject = null;
        setState('saving');
        try {
          const blob = new Blob(chunks, { type: r.mimeType || (video ? 'video/webm' : 'audio/webm') });
          let hostToken = '';
          try { hostToken = localStorage.getItem('unino_host_' + item.roomId) || ''; } catch {}
          const res = await fetch(backendUrl(`/room/${item.roomId}/clip/${item.shapeId}`), {
            method: 'POST',
            headers: { 'Content-Type': blob.type.split(';')[0], 'x-host-token': hostToken, 'x-supabase-token': (await supaToken()) || '' },
            body: blob,
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || 'Upload failed');
          onSaved(body.clipUrl);
        } catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed'); }
        setState('idle');
      };
      rec.current = r; r.start(); setState('rec');
      setTimeout(() => { if (r.state === 'recording') r.stop(); }, 60_000); // at most one minute
    } catch { setErr(t('Could not use the camera or microphone.')); }
  }

  return (
    <div className="flex flex-col gap-2">
      <video ref={preview} muted playsInline className={state === 'rec' ? 'w-full rounded-lg' : 'hidden'} />
      <div className="flex items-center gap-2 flex-wrap">
        {state === 'idle' && <>
          <button onClick={() => start(true)} className="cp-chip px-3 py-1.5 text-xs rounded-lg"><Glyph name="record" size={12} /> {t('Record video demo')}</button>
          <button onClick={() => start(false)} className="cp-chip px-3 py-1.5 text-xs rounded-lg"><Glyph name="mic" size={13} /> {t('Audio only')}</button>
        </>}
        {state === 'rec' && <button onClick={() => rec.current?.stop()} className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white"><Glyph name="stop" size={12} /> {t('Stop and save')}</button>}
        {state === 'saving' && <span className="text-xs" style={{ color: 'var(--t3)' }}>{t('Saving…')}</span>}
        {err && <span className="text-xs text-red-500">{err}</span>}
      </div>
    </div>
  );
}

export default function TechniqueLibrary({ onClose, onOpenAt }: {
  onClose: () => void;
  onOpenAt: (roomId: string, page: number) => void;
}) {
  const t = useT();
  const [items, setItems] = useState<TechniqueItem[] | null>(null);
  const [tech, setTech] = useState<SymbolId>('vibrato');
  const [student, setStudent] = useState('');
  const [recording, setRecording] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(backendUrl('/technique-library'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokens: getHostTokens(), supabaseToken: await supaToken() }),
        });
        const body = await res.json();
        setItems(Array.isArray(body.items) ? body.items : []);
      } catch { setItems([]); }
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const students = useMemo(() => [...new Set((items || []).map(i => i.studentTag).filter(Boolean))].sort(), [items]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items || []) c[i.symbolId] = (c[i.symbolId] || 0) + 1;
    return c;
  }, [items]);
  const shown = (items || []).filter(i => i.symbolId === tech && (!student || i.studentTag === student));

  return (
    <div className="fixed inset-0 z-[60] flex" role="dialog" aria-label={t('Technique library')}>
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="unino-modal w-full max-w-xl flex flex-col shadow-2xl overflow-hidden"
        style={{ animation: 'slideInRight 0.2s ease', backgroundColor: 'var(--panel-bg)', borderLeft: '1px solid var(--panel-border)' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--divider)' }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--t)' }}>{t('Technique library')}</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>{t('Every place you marked this technique, from all lessons.')}</p>
          </div>
          <button onClick={onClose} aria-label={t('Close')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.05]" style={{ color: 'var(--t3)' }}><Glyph name="close" size={14} /></button>
        </div>

        <div className="px-5 pt-3 flex flex-wrap gap-2 shrink-0">
          {TECHNIQUES.map(id => (
            <button key={id} onClick={() => setTech(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full ${tech === id ? 'bg-indigo-600 text-white' : 'cp-chip'}`}
              style={tech === id ? undefined : { color: 'var(--t)' }}>
              <SymbolIcon id={id} /> {t(SYMBOL_LABELS[id])} <span className="opacity-70">{counts[id] || 0}</span>
            </button>
          ))}
          {students.length > 0 && (
            <select value={student} onChange={e => setStudent(e.target.value)} className="u-input text-xs rounded-full px-2 py-1">
              <option value="">{t('All students')}</option>
              {students.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {items === null && <p className="text-sm" style={{ color: 'var(--t3)' }}>{t('Loading…')}</p>}
          {items && shown.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--t3)' }}>
              {t('No examples yet. In a lesson, open Symbols → Technique and place the mark on the score; it shows up here.')}
            </p>
          )}
          {shown.map(item => (
            <div key={item.roomId + item.shapeId} className="rounded-xl p-3 flex flex-col gap-2" style={{ border: '1px solid var(--divider)' }}>
              <BarPicture item={item} />
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}>
                <span className="font-medium truncate" style={{ color: 'var(--t)' }}>{item.scoreName}</span>
                {item.studentTag && <span>· {item.studentTag}</span>}
                <span>· {t('Page {n}', { n: item.page + 1 })}</span>
                {item.lastActive && <span>· {new Date(item.lastActive).toLocaleDateString()}</span>}
                <button onClick={() => onOpenAt(item.roomId, item.page)} className="ml-auto cp-chip px-2.5 py-1 rounded-lg" style={{ color: 'var(--t)' }}>{t('Open')} →</button>
              </div>
              {item.clipUrl && (
                item.clipUrl.endsWith('.mp4') || item.clipUrl.endsWith('.webm')
                  ? <video src={backendUrl(item.clipUrl)} controls playsInline className="w-full rounded-lg max-h-64 bg-black" />
                  : null
              )}
              {recording === item.shapeId
                ? <DemoRecorder item={item} onSaved={url => { setItems(list => (list || []).map(i => i.shapeId === item.shapeId && i.roomId === item.roomId ? { ...i, clipUrl: url } : i)); setRecording(null); }} />
                : <button onClick={() => setRecording(item.shapeId)} className="self-start text-xs underline" style={{ color: 'var(--t3)' }}>
                    {item.clipUrl ? t('Record a new demo') : t('Add a demo clip')}
                  </button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
