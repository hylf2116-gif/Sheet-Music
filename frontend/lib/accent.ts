// Theme colour ("accent"): the colour of buttons, highlights and selections across the app.
// The app's code uses Tailwind's indigo-* classes and var(--accent); choosing a theme colour
// redefines those variables on <html>, so every screen follows without code changes.

export interface Accent {
  id: string;
  name: string;     // English; translated with t()
  // shades 50, 100, 200, 300, 400, 500, 600, 700, 800, 900
  s: [string, string, string, string, string, string, string, string, string, string];
}

export const ACCENTS: Accent[] = [
  { id: 'indigo', name: 'Indigo', s: ['#eef2ff', '#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81'] },
  { id: 'ocean', name: 'Ocean', s: ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'] },
  { id: 'sky', name: 'Sky', s: ['#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e'] },
  { id: 'teal', name: 'Teal', s: ['#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a'] },
  { id: 'jade', name: 'Jade', s: ['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b'] },
  { id: 'bamboo', name: 'Bamboo', s: ['#f4f8ec', '#e5efd3', '#cbe0a8', '#a9cb76', '#88b44d', '#6b9a33', '#557d27', '#436222', '#384f20', '#2f431e'] },
  { id: 'honey', name: 'Honey', s: ['#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f'] },
  { id: 'sandalwood', name: 'Sandalwood', s: ['#faf6f1', '#f1e8dc', '#e2cdb3', '#cfad86', '#bb8d5e', '#a87444', '#8c5d36', '#714a2e', '#5d3e29', '#4e3525'] },
  { id: 'coral', name: 'Coral', s: ['#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12'] },
  { id: 'vermilion', name: 'Vermilion', s: ['#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'] },
  { id: 'rose', name: 'Rose', s: ['#fff1f2', '#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239', '#881337'] },
  { id: 'peony', name: 'Peony', s: ['#fdf2f8', '#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843'] },
  { id: 'plum', name: 'Plum', s: ['#faf5ff', '#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#581c87'] },
  { id: 'lavender', name: 'Lavender', s: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95'] },
  { id: 'ink', name: 'Ink', s: ['#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a'] },
];

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const KEY = 'unino_accent';

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function applyAccent(id: string) {
  const a = ACCENTS.find(x => x.id === id) ?? ACCENTS[0];
  const st = document.documentElement.style;
  a.s.forEach((hex, i) => st.setProperty(`--color-indigo-${STEPS[i]}`, hex));
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  st.setProperty('--accent', a.s[5]);
  st.setProperty('--accent-hover', a.s[6]);
  st.setProperty('--accent-fg', dark ? a.s[3] : a.s[6]);
  st.setProperty('--accent-bg', rgba(a.s[5], dark ? 0.14 : 0.09));
  // A soft wash of the colour behind the app, so the page carries the theme too.
  st.setProperty('--accent-wash', rgba(a.s[4], dark ? 0.10 : 0.12));
  document.documentElement.setAttribute('data-accent', a.id);
}

export function savedAccent(): string {
  try { return localStorage.getItem(KEY) || 'indigo'; } catch { return 'indigo'; }
}

export function setAccent(id: string) {
  try { localStorage.setItem(KEY, id); } catch {}
  applyAccent(id);
}
