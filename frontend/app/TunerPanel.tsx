'use client';

import { useRef, useState } from 'react';
import { INSTRUMENTS, type InstrumentKey } from '../lib/pitch';
import type { PitchReading } from '../hooks/usePitch';

interface Props {
  reading: PitchReading | null;
  error: string | null;
  instrument: InstrumentKey;
  a4Ref: number;
  onInstrumentChange: (k: InstrumentKey) => void;
  onA4Change: (hz: number) => void;
  onClose: () => void;
}

const A4_PRESETS = [415, 432, 440, 442, 446];

function playTone(freq: number) {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.04);
  gain.gain.setValueAtTime(0.35, ctx.currentTime + 2.2);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.5);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 2.6);
  setTimeout(() => ctx.close(), 3000);
}

function CentsMeter({ cents, active }: { cents: number; active: boolean }) {
  const c = active ? Math.max(-50, Math.min(50, cents)) : 0;
  const pct = (c + 50) / 100; // 0–1
  const color = !active
    ? 'rgba(255,255,255,0.15)'
    : Math.abs(c) <= 5 ? '#4ade80'
    : Math.abs(c) <= 15 ? '#fbbf24'
    : '#f87171';

  return (
    <div style={{ padding: '0 4px', marginBottom: 8 }}>
      {/* Track */}
      <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.07)' }}>
        {/* Zone overlays */}
        <div style={{ position: 'absolute', left: '45%', width: '10%', height: '100%', background: 'rgba(74,222,128,0.18)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: '35%', width: '10%', height: '100%', background: 'rgba(251,191,36,0.10)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: '55%', width: '10%', height: '100%', background: 'rgba(251,191,36,0.10)', borderRadius: 2 }} />
        {/* Needle */}
        <div style={{
          position: 'absolute', top: -3, width: 4, height: 12, borderRadius: 2,
          background: color, left: `calc(${pct * 100}% - 2px)`,
          transition: 'left 0.08s ease, background 0.12s ease',
          boxShadow: active ? `0 0 6px ${color}` : 'none',
        }} />
      </div>
      {/* Labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, padding: '0 2px' }}>
        {['-50', '-25', '0', '+25', '+50'].map(l => (
          <span key={l} style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace' }}>{l}</span>
        ))}
      </div>
    </div>
  );
}

export default function TunerPanel({ reading, error, instrument, a4Ref, onInstrumentChange, onA4Change, onClose }: Props) {
  const [pos, setPos] = useState({ x: 24, y: 80 });
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const [a4Input, setA4Input] = useState(String(a4Ref));
  const [playingFreq, setPlayingFreq] = useState<number | null>(null);

  const preset = INSTRUMENTS[instrument];
  const active = !!reading?.active;
  const cents = active ? reading!.cents : 0;
  const freq = active ? reading!.freq : 0;

  function startDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-nodrag]')) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
    function move(ev: MouseEvent) {
      if (!dragRef.current) return;
      setPos({ x: dragRef.current.px + ev.clientX - dragRef.current.sx, y: dragRef.current.py + ev.clientY - dragRef.current.sy });
    }
    function up() {
      dragRef.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function handlePlayString(freq: number) {
    const adjusted = freq * (a4Ref / 440);
    setPlayingFreq(freq);
    playTone(adjusted);
    setTimeout(() => setPlayingFreq(null), 2600);
  }

  function commitA4(val: string) {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 415 && n <= 466) onA4Change(n);
    setA4Input(String(a4Ref));
  }


  return (
    <div
      onMouseDown={startDrag}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 50,
        width: 300, borderRadius: 16, overflow: 'hidden',
        background: 'var(--float-bg-soft)', backdropFilter: 'blur(24px)',
        border: '1px solid var(--float-border)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        cursor: 'grab', userSelect: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: '1px solid var(--float-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Tuner</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-nodrag>
          {/* Instrument selector */}
          <select
            value={instrument}
            onChange={e => onInstrumentChange(e.target.value as InstrumentKey)}
            style={{ fontSize: 11, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#94a3b8', padding: '3px 6px', cursor: 'pointer' }}
          >
            {Object.entries(INSTRUMENTS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button
            onClick={onClose}
            style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main display */}
      <div style={{ padding: '20px 20px 12px', textAlign: 'center' }}>
        {error ? (
          <div style={{ padding: '12px 8px', background: 'rgba(248,113,113,0.1)', borderRadius: 10, border: '1px solid rgba(248,113,113,0.2)', marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: '#fca5a5', margin: 0 }}>{error}</p>
          </div>
        ) : (
          <>
            {/* Note name + octave */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2, lineHeight: 1, color: active ? '#f8fafc' : 'rgba(255,255,255,0.18)', transition: 'color 0.15s' }}>
                {active ? reading!.note : '—'}
              </span>
              {active && (
                <span style={{ fontSize: 28, fontWeight: 500, color: '#94a3b8', verticalAlign: 'super', marginLeft: 2 }}>
                  {reading!.octave}
                </span>
              )}
            </div>

            {/* Hz + cents */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
                {active ? `${freq.toFixed(1)} Hz` : '— Hz'}
              </span>
              <span style={{
                fontSize: 14, fontWeight: 600, fontFamily: 'monospace',
                color: !active ? 'rgba(255,255,255,0.18)'
                  : Math.abs(cents) <= 5 ? '#4ade80'
                  : Math.abs(cents) <= 15 ? '#fbbf24' : '#f87171',
                transition: 'color 0.1s',
                minWidth: 48,
              }}>
                {active ? (cents >= 0 ? `+${cents}¢` : `${cents}¢`) : ''}
              </span>
            </div>

            {/* Cents meter */}
            <CentsMeter cents={cents} active={active} />
          </>
        )}
      </div>

      {/* A4 reference */}
      <div style={{ padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.05)' }} data-nodrag>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>A4 reference</span>
          <input
            type="number" min={415} max={466} value={a4Input}
            onChange={e => setA4Input(e.target.value)}
            onBlur={e => commitA4(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && commitA4(a4Input)}
            style={{ width: 52, fontSize: 12, textAlign: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#e2e8f0', padding: '3px 4px' }}
          />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Hz</span>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {A4_PRESETS.map(hz => (
            <button key={hz} onClick={() => { onA4Change(hz); setA4Input(String(hz)); }}
              style={{
                fontSize: 11, padding: '3px 9px', borderRadius: 6, border: '1px solid',
                borderColor: a4Ref === hz ? '#818cf8' : 'rgba(255,255,255,0.1)',
                background: a4Ref === hz ? 'rgba(129,140,248,0.18)' : 'transparent',
                color: a4Ref === hz ? '#818cf8' : 'rgba(255,255,255,0.45)',
                cursor: 'pointer', transition: 'all 0.1s',
              }}
            >
              {hz}
            </button>
          ))}
        </div>
      </div>

      {/* Open strings */}
      {preset.strings.length > 0 && (
        <div style={{ padding: '10px 20px 16px', borderTop: '1px solid rgba(255,255,255,0.05)' }} data-nodrag>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 500, display: 'block', marginBottom: 7 }}>Reference tones</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {preset.strings.map(s => {
              const isPlaying = playingFreq === s.freq;
              return (
                <button key={s.note} onClick={() => handlePlayString(s.freq)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, border: '1px solid',
                    borderColor: isPlaying ? '#818cf8' : 'rgba(255,255,255,0.12)',
                    background: isPlaying ? 'rgba(129,140,248,0.2)' : 'rgba(255,255,255,0.04)',
                    color: isPlaying ? '#818cf8' : '#94a3b8',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {s.note}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
