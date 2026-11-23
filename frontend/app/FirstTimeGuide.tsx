'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { useT } from '../lib/i18n';

// A 3-step guide shown the first time someone enters a room on this device:
// where to draw, how the other person sees it, and where to turn pages and zoom.
// Each step points at a real control (marked with data-tour="…"). Skippable; never shown again.

const STORAGE_KEY = 'unino_guide_done';

interface Step { target: string; title: string; body: string }

function visibleTarget(key: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export default function FirstTimeGuide({ isHost, ready }: { isHost: boolean; ready: boolean }) {
  const t = useT();
  const [step, setStep] = useState(-1); // -1 = not showing
  const [rect, setRect] = useState<DOMRect | null>(null);

  const steps: Step[] = [
    { target: 'draw', title: t('Draw right on the score'),
      body: t('Pick the pen and circle, write or mark anything. Arrows, text and music symbols are next to it.') },
    isHost
      ? { target: 'share', title: t('Send this link to your student'),
          body: t('They open it in any browser, no app needed. Whatever either of you draws shows up for the other at once.') }
      : { target: 'share', title: t('You are in the same score as your teacher'),
          body: t('What your teacher draws appears here at once, and they see your marks too.') },
    { target: 'nav', title: t('Turn pages and zoom here'),
      body: isHost ? t('Your student follows your page turns. Zoom only changes your own view.') : t('You follow your teacher’s page turns. Zoom only changes your own view.') },
  ];

  // Start once the room is ready, for people who haven't seen the guide on this device.
  useEffect(() => {
    if (!ready) return;
    let done = false;
    try { done = localStorage.getItem(STORAGE_KEY) === '1'; } catch {}
    if (done) return;
    const timer = setTimeout(() => setStep(0), 800); // let the toolbar and page settle first
    return () => clearTimeout(timer);
  }, [ready]);

  // Follow the pointed-at control (window resize, toolbar moving).
  useLayoutEffect(() => {
    if (step < 0) return;
    const update = () => setRect(visibleTarget(steps[step].target)?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener('resize', update);
    const iv = setInterval(update, 500);
    return () => { window.removeEventListener('resize', update); clearInterval(iv); };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    setStep(-1);
  }

  if (step < 0) return null;
  const s = steps[step];
  const last = step === steps.length - 1;

  // Card below the control if there is room, else above; kept inside the screen.
  const W = 300;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1000;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let left = vw / 2 - W / 2, top = vh / 2 - 90;
  if (rect) {
    left = Math.min(vw - W - 12, Math.max(12, rect.left + rect.width / 2 - W / 2));
    top = rect.bottom + 12 + 170 < vh ? rect.bottom + 12 : Math.max(12, rect.top - 12 - 170);
  }

  return (
    <div role="dialog" aria-label={t('Quick tour')} style={{ position: 'fixed', inset: 0, zIndex: 70, pointerEvents: 'none' }}>
      {/* soft dim with a hole around the control */}
      {rect && (
        <div style={{
          position: 'fixed', left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12,
          borderRadius: 12, boxShadow: '0 0 0 9999px rgba(15,15,30,0.35), 0 0 0 3px #818cf8', transition: 'all 0.25s ease',
        }} />
      )}
      <div style={{
        position: 'fixed', left, top, width: W, pointerEvents: 'auto', background: 'white', color: '#1c1c1e',
        borderRadius: 16, padding: '16px 16px 12px', boxShadow: '0 18px 50px rgba(0,0,0,0.25)', transition: 'all 0.25s ease',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', letterSpacing: '0.06em' }}>
          {t('Step {n} of {total}', { n: step + 1, total: steps.length })}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 6px' }}>{s.title}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#4b5563' }}>{s.body}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <button onClick={finish} style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            {t('Skip')}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} style={{ fontSize: 13, padding: '7px 12px', borderRadius: 10, border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer' }}>
                {t('Back')}
              </button>
            )}
            <button onClick={() => (last ? finish() : setStep(step + 1))} style={{
              fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 10, border: 'none', background: '#6366f1', color: 'white', cursor: 'pointer',
            }}>
              {last ? t('Start the lesson') : t('Next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
