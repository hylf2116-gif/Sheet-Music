'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { useT } from '../lib/i18n';

// Step-by-step tour: each step points at a real control (marked data-tour="…") or sits in the
// middle of the screen. A step can wait for the person to actually do something (waitFor) and
// then moves on by itself, or offer its own button (action).

export interface TourStep {
  target?: string;                 // data-tour key; none = centered card
  title: string;
  body: string;
  waitFor?: () => boolean;         // checked twice a second; true → next step
  doneText?: string;               // shown briefly when waitFor becomes true
  action?: { label: string; run: () => void | Promise<void> }; // replaces "Next"
  hideBack?: boolean;
}

function visibleTarget(key: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export default function Tour({ steps, onClose, startAt = 0 }: {
  steps: TourStep[];
  onClose: (finished: boolean) => void;  // finished = went through the last step
  startAt?: number;
}) {
  const t = useT();
  const [step, setStep] = useState(startAt);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const s = steps[Math.min(step, steps.length - 1)];
  const last = step >= steps.length - 1;

  // Follow the pointed-at control.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a centered step has nothing to point at
    if (!s.target) { setRect(null); return; }
    const update = () => setRect(visibleTarget(s.target!)?.getBoundingClientRect() ?? null);
    // Bring the control into view first if it is off screen (e.g. below the fold on the home page).
    const el = visibleTarget(s.target);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    update();
    window.addEventListener('resize', update);
    const iv = setInterval(update, 400);
    return () => { window.removeEventListener('resize', update); clearInterval(iv); };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Steps that wait for a real action move on by themselves.
  useEffect(() => {
    if (!s.waitFor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const iv = setInterval(() => {
      if (s.waitFor!()) {
        clearInterval(iv);
        setCelebrate(true);
        timer = setTimeout(() => { setCelebrate(false); setStep(n => n + 1); }, 1100);
      }
    }, 500);
    return () => { clearInterval(iv); if (timer) clearTimeout(timer); };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const W = 320;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1000;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let left = vw / 2 - W / 2, top = vh / 2 - 110;
  if (rect) {
    left = Math.min(vw - W - 12, Math.max(12, rect.left + rect.width / 2 - W / 2));
    top = rect.bottom + 12 + 200 < vh ? rect.bottom + 12 : Math.max(12, rect.top - 12 - 200);
  }
  const centered = !s.target;

  return (
    <div role="dialog" aria-label={t('Quick tour')} style={{ position: 'fixed', inset: 0, zIndex: 70, pointerEvents: 'none' }}>
      {centered && <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,30,0.35)', pointerEvents: 'auto' }} />}
      {rect && (
        <div style={{
          position: 'fixed', left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12,
          borderRadius: 12, boxShadow: '0 0 0 9999px rgba(15,15,30,0.30), 0 0 0 3px #818cf8', transition: 'all 0.25s ease',
        }} />
      )}
      <div style={{
        position: 'fixed', left, top, width: W, pointerEvents: 'auto', background: 'white', color: '#1c1c1e',
        borderRadius: 16, padding: '16px 16px 12px', boxShadow: '0 18px 50px rgba(0,0,0,0.25)', transition: 'all 0.25s ease',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', letterSpacing: '0.06em' }}>
          {t('Step {n} of {total}', { n: step + 1, total: steps.length })}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 6px' }}>{celebrate ? (s.doneText || t('Nice!')) : s.title}</div>
        {!celebrate && <div style={{ fontSize: 13, lineHeight: 1.55, color: '#4b5563' }}>{s.body}</div>}
        {s.waitFor && !celebrate && (
          <div style={{ fontSize: 12, color: '#6366f1', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: '#6366f1', animation: 'pulse 1.2s ease-in-out infinite' }} />
            {t('Try it now. This moves on when you do.')}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <button onClick={() => onClose(false)} style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            {t('Skip tutorial')}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {step > 0 && !s.hideBack && (
              <button onClick={() => setStep(step - 1)} style={{ fontSize: 13, padding: '7px 12px', borderRadius: 10, border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer' }}>
                {t('Back')}
              </button>
            )}
            {s.action ? (
              <button onClick={() => s.action!.run()} style={{ fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 10, border: 'none', background: '#6366f1', color: 'white', cursor: 'pointer' }}>
                {s.action.label}
              </button>
            ) : !s.waitFor && (
              <button onClick={() => (last ? onClose(true) : setStep(step + 1))} style={{
                fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 10, border: 'none', background: '#6366f1', color: 'white', cursor: 'pointer',
              }}>
                {last ? t('Done') : t('Next')}
              </button>
            )}
            {s.waitFor && !celebrate && (
              <button onClick={() => setStep(step + 1)} style={{ fontSize: 12, padding: '7px 10px', borderRadius: 10, border: '1px solid #e5e7eb', background: 'white', color: '#6b7280', cursor: 'pointer' }}>
                {t('Skip this step')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
