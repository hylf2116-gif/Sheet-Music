'use client';

import { useT } from '../lib/i18n';

// How annotation colors work in a room (chosen when the room is created; the host can change it later).
//   free     — any color for any mark (old behaviour)
//   assigned — one color per person, set by the host
//   self     — everyone gets a starting color of their own; any mark can still use any color
export type ColorMode = 'free' | 'assigned' | 'self';

export const COLOR_MODE_KEY = 'unino_color_mode';

export function loadColorMode(): ColorMode {
  try {
    const v = localStorage.getItem(COLOR_MODE_KEY);
    if (v === 'free' || v === 'assigned' || v === 'self') return v;
  } catch {}
  return 'free';
}

// Colors offered when picking a person's color (same set the server hands out).
export const PERSON_PALETTE = ['#e53935', '#1e88e5', '#43a047', '#8e24aa', '#fb8c00', '#00897b', '#d81b60', '#6d4c41', '#3949ab', '#7cb342'];

export const COLOR_MODE_OPTIONS: { value: ColorMode; title: string; hint: string }[] = [
  { value: 'free', title: 'Free', hint: 'Anyone can use any color for any mark.' },
  { value: 'assigned', title: 'Host assigns', hint: 'Each student draws in the color the host gives them. The host can use any color.' },
  { value: 'self', title: 'Each picks', hint: 'Everyone starts with their own color, and each mark can use any color.' },
];

// Tiny picture for each option: who draws in which color.
function Preview({ mode, active }: { mode: ColorMode; active: boolean }) {
  const dim = active ? 1 : 0.75;
  if (mode === 'free') {
    // One person, marks in many colors
    return (
      <svg viewBox="0 0 64 28" width="64" height="28" aria-hidden style={{ opacity: dim }}>
        <path d="M4 20c6-10 10-10 16 0" stroke="#e53935" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M24 20c6-10 10-10 16 0" stroke="#1e88e5" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M44 20c6-10 10-10 16 0" stroke="#43a047" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  // Several people, each with their own color; a small badge on the right says who decides
  const people = ['#e53935', '#1e88e5', '#43a047'];
  return (
    <svg viewBox="0 0 64 28" width="64" height="28" aria-hidden style={{ opacity: dim }}>
      {people.map((c, i) => (
        <g key={c} transform={`translate(${8 + i * 16} 15)`}>
          <circle r="7.5" fill={c} stroke="var(--app-bg)" strokeWidth="1.5" />
          <circle cy="-2" r="2.4" fill="white" />
          <path d="M-4 5a4 3.4 0 0 1 8 0" fill="white" />
        </g>
      ))}
      {mode === 'assigned'
        // crown: the host decides
        ? <path d="M50 19l1.5-8 3.5 3.5 3-5 3 5 3.5-3.5L66 19z" transform="translate(-4 0)" fill="#f59e0b" />
        // brush: everyone decides
        : <g transform="translate(57 15)"><path d="M-4 5l7-9a1.8 1.8 0 0 1 2.6 2.4L-1.5 7z" fill="var(--color-indigo-500)" /><circle cx="-4.5" cy="6" r="2" fill="var(--color-indigo-500)" /></g>}
    </svg>
  );
}

export default function ColorModePicker({ value, onChange, compact = false }: {
  value: ColorMode; onChange: (m: ColorMode) => void; compact?: boolean;
}) {
  const t = useT();
  const selected = COLOR_MODE_OPTIONS.find(o => o.value === value) ?? COLOR_MODE_OPTIONS[0];
  return (
    <div className="w-full flex flex-col gap-2 text-left">
      <span className={`${compact ? 'text-[11px]' : 'text-xs'} font-semibold`} style={{ color: 'var(--t2)' }}>
        {t('Annotation colors')}
      </span>
      <div role="radiogroup" aria-label={t('Annotation colors')} className="grid grid-cols-3 gap-1.5">
        {COLOR_MODE_OPTIONS.map(o => {
          const active = o.value === value;
          return (
            <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)}
              title={t(o.hint)}
              className="flex flex-col items-center justify-start gap-1.5 rounded-xl transition-all"
              style={{
                padding: compact ? '6px 2px' : '10px 4px 8px',
                background: active ? 'rgba(99,102,241,0.10)' : 'transparent',
                border: `1.5px solid ${active ? 'var(--color-indigo-500)' : 'var(--border)'}`,
                boxShadow: active ? '0 0 0 3px rgba(99,102,241,0.12)' : 'none',
              }}>
              {!compact && <Preview mode={o.value} active={active} />}
              <span className={`${compact ? 'text-[11px]' : 'text-xs'} font-semibold leading-tight text-center`}
                style={{ color: active ? 'var(--color-indigo-500)' : 'var(--t2)' }}>
                {t(o.title)}
              </span>
            </button>
          );
        })}
      </div>
      <p className={`${compact ? 'text-[10.5px]' : 'text-xs'} leading-snug`} style={{ color: 'var(--t3)' }}>{t(selected.hint)}</p>
    </div>
  );
}
