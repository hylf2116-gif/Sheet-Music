'use client';

import { useEffect, useRef, useState } from 'react';

// One detected measure, in normalized page coordinates (0..1).
export interface OmrMeasure { n: number; x: number; y: number; w: number; h: number }

export interface OmrState {
  status: 'none' | 'running' | 'done' | 'error' | 'unavailable';
  // staffHeight: one 5-line staff height as a fraction of page height (absent in older results).
  pages?: { page: number; measures: OmrMeasure[]; staffHeight?: number }[];
  measureCount?: number;
  hasMusicXml?: boolean;
  progress?: { page: number; total: number | null } | null;
  startedAt?: number;
  error?: string;
  reason?: string;
  highlightedMeasure: number | null;
}

// Per-viewer display preferences; every OMR feature is optional.
export interface OmrPrefs {
  showNumbers: boolean;
  showHighlight: boolean;
  clickToHighlight: boolean;
}
export const DEFAULT_OMR_PREFS: OmrPrefs = { showNumbers: false, showHighlight: true, clickToHighlight: false };

interface Props {
  state: OmrState | null;
  isHost: boolean;
  prefs: OmrPrefs;
  musicXmlUrl: string;
  rightOffset: number;
  onPrefsChange: (p: OmrPrefs) => void;
  onDetect: () => void;
  onJump: (n: number) => boolean;
  onClearHighlight: () => void;
  onClose: () => void;
}

function Toggle({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: '#6366f1' }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 12.5, color: 'var(--t)' }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--t3)' }}>{hint}</span>}
      </span>
    </label>
  );
}

const btn: React.CSSProperties = {
  border: 'none', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

export default function OMRPanel({
  state, isHost, prefs, musicXmlUrl, rightOffset,
  onPrefsChange, onDetect, onJump, onClearHighlight, onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [jumpText, setJumpText] = useState('');
  const [jumpError, setJumpError] = useState('');

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const status = state?.status ?? 'none';
  const done = status === 'done';
  const set = (k: keyof OmrPrefs) => (v: boolean) => onPrefsChange({ ...prefs, [k]: v });

  function submitJump(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(jumpText);
    if (!Number.isInteger(n) || n < 1) { setJumpError('Enter a bar number'); return; }
    if (!onJump(n)) { setJumpError(`Bar ${n} not found (1–${state?.measureCount ?? 0})`); return; }
    setJumpError('');
  }

  let statusText = '';
  if (status === 'running') {
    const p = state?.progress;
    statusText = p?.total ? `Detecting measures… page ${p.page} of ${p.total}` : 'Detecting measures…';
  } else if (status === 'done') statusText = `${state?.measureCount ?? 0} bars detected`;
  else if (status === 'error') statusText = state?.error || 'Detection failed';
  else if (status === 'unavailable') statusText = state?.reason || 'Measure detection is not available';
  else statusText = isHost ? 'Bars have not been detected for this score yet.' : 'The host has not detected bars for this score yet.';

  return (
    <div ref={ref} style={{
      position: 'fixed', right: rightOffset + 56, top: '50%', transform: 'translateY(-50%)', zIndex: 40,
      width: 260, backgroundColor: 'var(--modal-bg)', border: '1px solid var(--border-md)', borderRadius: 14,
      boxShadow: '0 8px 32px rgba(0,0,0,0.32)', backdropFilter: 'blur(18px) saturate(1.6)', padding: 12,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t)' }}>Measures</span>
        <button onClick={onClose} title="Close" style={{ ...btn, padding: '2px 6px', background: 'transparent', color: 'var(--t3)' }}>✕</button>
      </div>

      <div style={{ fontSize: 12, color: status === 'error' ? '#ef4444' : 'var(--t2)', display: 'flex', alignItems: 'center', gap: 6 }}>
        {status === 'running' && (
          <span style={{ width: 10, height: 10, borderRadius: 5, border: '2px solid #818cf8', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
        )}
        <span>{statusText}</span>
      </div>
      {status === 'running' && (
        <div style={{ fontSize: 11, color: 'var(--t3)' }}>Takes about 1 minute per page. You can keep teaching meanwhile.</div>
      )}

      {isHost && (status === 'none' || status === 'error' || status === 'done') && (
        <button onClick={onDetect} style={{
          ...btn, background: done ? 'transparent' : '#6366f1', color: done ? 'var(--t3)' : 'white',
          border: done ? '1px solid var(--border-md)' : 'none',
        }}>
          {done ? 'Detect again' : 'Detect measures'}
        </button>
      )}

      {done && (
        <>
          <div style={{ height: 1, background: 'var(--divider)', margin: '2px 0' }} />
          <Toggle label="Show bar numbers" checked={prefs.showNumbers} onChange={set('showNumbers')} />
          <Toggle label="Show highlighted bar" hint="Highlights are shared with everyone in the room."
            checked={prefs.showHighlight} onChange={set('showHighlight')} />
          <Toggle label="Click a bar to highlight it" hint="While on, clicking inside a bar highlights it instead of drawing."
            checked={prefs.clickToHighlight} onChange={set('clickToHighlight')} />
          {state?.highlightedMeasure != null && (
            <button onClick={onClearHighlight} style={{ ...btn, background: 'transparent', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>
              Clear highlight (bar {state.highlightedMeasure})
            </button>
          )}

          <div style={{ height: 1, background: 'var(--divider)', margin: '2px 0' }} />
          <form onSubmit={submitJump} style={{ display: 'flex', gap: 6 }}>
            <input value={jumpText} onChange={e => { setJumpText(e.target.value); setJumpError(''); }}
              inputMode="numeric" placeholder="Go to bar…" aria-label="Bar number"
              style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border-md)', background: 'transparent', color: 'var(--t)' }} />
            <button type="submit" style={{ ...btn, background: '#6366f1', color: 'white' }}>Go</button>
          </form>
          {jumpError && <div style={{ fontSize: 11, color: '#ef4444' }}>{jumpError}</div>}
          {isHost && <div style={{ fontSize: 11, color: 'var(--t3)' }}>When you jump, everyone in the room jumps too.</div>}

          {state?.hasMusicXml && (
            <>
              <div style={{ height: 1, background: 'var(--divider)', margin: '2px 0' }} />
              <a href={musicXmlUrl} download style={{ ...btn, textAlign: 'center', textDecoration: 'none', background: 'transparent', color: 'var(--t2)', border: '1px solid var(--border-md)' }}>
                Export MusicXML
              </a>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>Automatic recognition — notes may contain mistakes.</div>
            </>
          )}
        </>
      )}
    </div>
  );
}
