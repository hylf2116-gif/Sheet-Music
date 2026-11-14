'use client';

import { useT } from '../lib/i18n';

// How annotation colors work in a room (chosen when the room is created; the host can change it later).
//   free     — any color for any mark (old behaviour)
//   assigned — one color per person, set by the host
//   self     — one color per person, each person picks their own
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

export const COLOR_MODE_OPTIONS: { value: ColorMode; label: string }[] = [
  { value: 'free', label: 'Any color for any mark' },
  { value: 'assigned', label: 'One color per person — host assigns' },
  { value: 'self', label: 'One color per person — everyone picks their own' },
];

export default function ColorModePicker({ value, onChange, compact = false }: {
  value: ColorMode; onChange: (m: ColorMode) => void; compact?: boolean;
}) {
  const t = useT();
  return (
    <label className={`w-full flex flex-col gap-1.5 ${compact ? '' : 'text-left'}`}>
      <span className="text-xs font-medium" style={{ color: 'var(--t3)' }}>{t('Annotation colors')}</span>
      <select value={value} onChange={e => onChange(e.target.value as ColorMode)}
        className="w-full text-sm rounded-lg px-3 py-2 cursor-pointer"
        style={{ background: 'var(--app-bg)', color: 'var(--t)', border: '1px solid var(--border)' }}>
        {COLOR_MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
      </select>
    </label>
  );
}
