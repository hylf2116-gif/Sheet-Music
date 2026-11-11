'use client';

import { useEffect, useRef, useState } from 'react';
import { freqToNote, medianOf } from '../lib/pitch';
import type { PitchReading } from '../hooks/usePitch';

export interface RemotePitchEntry {
  senderId: string;
  senderName: string;
  note: string;
  cents: number;
  freq: number;
  midi: number;
  updatedAt: number;
}

interface TracePoint { time: number; freq: number; }

interface Props {
  pitchReading: PitchReading | null;
  a4Ref: number;
  remotePitches: Record<string, RemotePitchEntry>;
  shareEnabled: boolean;
  onShareChange: (v: boolean) => void;
  onClose: () => void;
  myName: string;
}

/** Deterministic color from a string key. */
function senderColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return `hsl(${(h * 137) % 360}, 65%, 62%)`;
}

function centsColor(cents: number): string {
  return Math.abs(cents) <= 5 ? '#4ade80' : Math.abs(cents) <= 15 ? '#fbbf24' : '#f87171';
}

function drawTrace(
  canvas: HTMLCanvasElement,
  traces: { color: string; points: TracePoint[] }[],
  a4: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);

  const now = Date.now();
  const duration = 10_000;

  // Find center MIDI from all recent non-zero freqs
  const allFreqs: number[] = [];
  for (const { points } of traces) {
    for (const p of points) if (p.freq > 0) allFreqs.push(p.freq);
  }
  if (!allFreqs.length) return;

  const { midi: centerMidi } = freqToNote(medianOf(allFreqs), a4);
  const midiMin = centerMidi - 6;
  const midiMax = centerMidi + 6;

  function xOf(t: number) { return W * (1 - (now - t) / duration); }
  function yOf(midiF: number) { return H - H * (midiF - midiMin) / (midiMax - midiMin); }

  // Faint in-tune reference lines
  for (let m = Math.ceil(midiMin); m <= Math.floor(midiMax); m++) {
    const y = yOf(m);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.moveTo(0, y); ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Draw each sender's trace
  for (const { color, points } of traces) {
    if (points.length < 2) continue;
    let prev: { x: number; y: number } | null = null;
    for (const p of points) {
      if (p.freq <= 0) { prev = null; continue; }
      const { midi: m, cents } = freqToNote(p.freq, a4);
      const midiF = m + cents / 100;
      const x = xOf(p.time);
      const y = yOf(midiF);
      if (x < -4 || x > W + 4) { prev = null; continue; }

      if (prev) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        ctx.moveTo(prev.x, prev.y); ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      prev = { x, y };
    }
  }
}

export default function PitchTrace({ pitchReading, a4Ref, remotePitches, shareEnabled, onShareChange, onClose, myName }: Props) {
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState({ x: window.innerWidth - 340, y: 120 });
  // Clock for "is this remote sender still active" (render must not call Date.now directly).
  const [now, setNow] = useState(() => Date.now());
  const hasRemote = Object.keys(remotePitches).length > 0;
  useEffect(() => {
    if (!hasRemote) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [hasRemote]);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Trace data in refs (no React re-renders per point)
  const myTraceRef = useRef<TracePoint[]>([]);
  const remoteTracesRef = useRef<Record<string, TracePoint[]>>({});
  const pitchRef = useRef(pitchReading);
  const remotePitchesRef = useRef(remotePitches);
  const a4Ref$ = useRef(a4Ref);

  useEffect(() => { pitchRef.current = pitchReading; }, [pitchReading]);
  useEffect(() => { remotePitchesRef.current = remotePitches; }, [remotePitches]);
  useEffect(() => { a4Ref$.current = a4Ref; }, [a4Ref]);

  // Accumulate remote trace data when remotePitches changes
  useEffect(() => {
    const now = Date.now();
    for (const [id, entry] of Object.entries(remotePitches)) {
      if (!remoteTracesRef.current[id]) remoteTracesRef.current[id] = [];
      remoteTracesRef.current[id].push({ time: now, freq: entry.freq });
    }
    // Expire senders who have gone quiet for > 3s
    for (const id of Object.keys(remoteTracesRef.current)) {
      if (!remotePitches[id]) {
        delete remoteTracesRef.current[id];
      }
    }
  }, [remotePitches]);

  // 20 Hz timer: append own trace + redraw canvas
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const reading = pitchRef.current;
      myTraceRef.current.push({ time: now, freq: reading?.active ? reading.freq : 0 });

      const cutoff = now - 10_000;
      myTraceRef.current = myTraceRef.current.filter(p => p.time > cutoff);
      for (const id of Object.keys(remoteTracesRef.current)) {
        remoteTracesRef.current[id] = remoteTracesRef.current[id].filter(p => p.time > cutoff);
      }

      if (!canvasRef.current || minimized) return;
      const a4 = a4Ref$.current;

      const myColor = '#818cf8';
      const traces: { color: string; points: TracePoint[] }[] = [
        { color: myColor, points: myTraceRef.current },
        ...Object.entries(remoteTracesRef.current).map(([id, pts]) => ({
          color: senderColor(id),
          points: pts,
        })),
      ];
      drawTrace(canvasRef.current, traces, a4);
    }, 50);
    return () => clearInterval(timer);
  }, [minimized]);

  function startDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-nodrag]')) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
    function move(ev: MouseEvent) {
      if (!dragRef.current) return;
      setPos({ x: dragRef.current.px + ev.clientX - dragRef.current.sx, y: dragRef.current.py + ev.clientY - dragRef.current.sy });
    }
    function up() { dragRef.current = null; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  const active = !!pitchReading?.active;
  const noteLabel = active ? `${pitchReading!.note}${pitchReading!.octave}` : '—';
  const cents = active ? pitchReading!.cents : 0;
  const freqLabel = active ? `${pitchReading!.freq.toFixed(1)} Hz` : '';
  const cColor = active ? centsColor(cents) : 'rgba(255,255,255,0.3)';

  const remoteList = Object.values(remotePitches).filter(r => now - r.updatedAt < 3000);

  return (
    <div
      onMouseDown={startDrag}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 50,
        width: 300, borderRadius: 14, overflow: 'hidden',
        background: 'var(--float-bg-soft)', backdropFilter: 'blur(20px)',
        border: '1px solid var(--float-border)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
        cursor: 'grab', userSelect: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 13px', borderBottom: '1px solid var(--float-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>Live Pitch</span>
          {remoteList.length > 0 && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '1px 6px' }}>
              +{remoteList.length}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }} data-nodrag>
          <button onClick={() => setMinimized(m => !m)}
            style={{ width: 22, height: 22, borderRadius: 5, border: 'none', background: 'rgba(255,255,255,0.07)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ width: 11, height: 11 }}>
              {minimized ? <path d="M5 15l7-7 7 7" /> : <path d="M19 9l-7 7-7-7" />}
            </svg>
          </button>
          <button onClick={onClose}
            style={{ width: 22, height: 22, borderRadius: 5, border: 'none', background: 'rgba(255,255,255,0.07)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Own pitch display */}
          <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: '#818cf8', flexShrink: 0, boxShadow: active ? '0 0 8px #818cf8' : 'none', transition: 'box-shadow 0.2s' }} />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', minWidth: 32 }}>{myName.split(' ')[0]}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: active ? '#f8fafc' : 'rgba(255,255,255,0.2)', minWidth: 44, fontFamily: 'monospace', transition: 'color 0.1s' }}>{noteLabel}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: cColor, fontFamily: 'monospace', minWidth: 40, transition: 'color 0.1s' }}>
              {active ? (cents >= 0 ? `+${cents}¢` : `${cents}¢`) : ''}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', marginLeft: 'auto' }}>{freqLabel}</span>
          </div>

          {/* Scrolling trace canvas */}
          <div style={{ padding: '0 14px 8px' }}>
            <canvas ref={canvasRef} width={272} height={72}
              style={{ display: 'block', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }} />
          </div>

          {/* Remote senders */}
          {remoteList.length > 0 && (
            <div style={{ padding: '0 14px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {remoteList.map(r => {
                const rColor = senderColor(r.senderId);
                const isActive = now - r.updatedAt < 500;
                return (
                  <div key={r.senderId} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: isActive ? 1 : 0.4, transition: 'opacity 0.3s' }}>
                    <div style={{ width: 7, height: 7, borderRadius: 3.5, background: rColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', minWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.senderName}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace', minWidth: 36 }}>{r.note}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: centsColor(r.cents), fontFamily: 'monospace' }}>
                      {r.cents >= 0 ? `+${r.cents}¢` : `${r.cents}¢`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Share toggle */}
          <div style={{ padding: '8px 14px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }} data-nodrag>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <div
                onClick={() => onShareChange(!shareEnabled)}
                style={{
                  width: 32, height: 18, borderRadius: 9, position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  background: shareEnabled ? '#818cf8' : 'rgba(255,255,255,0.12)',
                }}
              >
                <div style={{
                  position: 'absolute', top: 2, width: 14, height: 14, borderRadius: 7, background: 'white',
                  left: shareEnabled ? 16 : 2, transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </div>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.3 }}>
                Share my pitch with the room
              </span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
