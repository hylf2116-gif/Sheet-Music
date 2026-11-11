'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SYMBOL_DEFS, SYMBOL_GROUPS, SYMBOL_LABELS, type SymbolId } from './symbols';

export type SymbolSize = 'S' | 'M' | 'L';
// Lesson markings are drawn larger than engraved print, so even S is above print size.
export const SYMBOL_SIZE_FACTOR: Record<SymbolSize, number> = { S: 1.2, M: 1.8, L: 2.6 };
// Bravura's fingering digits are tiny at print size; enlarge them so they stay readable.
const SYMBOL_BOOST: Partial<Record<SymbolId, number>> = {
  finger0: 1.6, finger1: 1.6, finger2: 1.6, finger3: 1.6, finger4: 1.6, thumb: 1.6,
};
// Default em (= one staff height, 4 staff spaces) as a fraction of page height,
// used when no staff height is known from measure detection.
export const DEFAULT_SYMBOL_EM = 0.022;

export function isSymbolId(id: unknown): id is SymbolId {
  return typeof id === 'string' && id in SYMBOL_DEFS;
}

// Build a symbol annotation centered at (cx, cy) in normalized page coordinates.
// em = staff height as a fraction of page height; asp = pageHeight / pageWidth.
export function makeSymbolAnnotation(
  symbolId: SymbolId, page: number, cx: number, cy: number, em: number, asp: number, color: string,
) {
  const def = SYMBOL_DEFS[symbolId];
  const h = Math.max((def.bh / 1000) * em * (SYMBOL_BOOST[symbolId] ?? 1), 0.004);
  const w = Math.max((def.bw / def.bh) * h * asp, 0.004);
  const x = Math.min(Math.max(cx - w / 2, 0), Math.max(1 - w, 0));
  const y = Math.min(Math.max(cy - h / 2, 0), Math.max(1 - h, 0));
  return { id: crypto.randomUUID(), type: 'symbol', symbolId, page, x, y, w, h, color };
}

// The symbol drawn into a box (x, y, w, h) inside a parent SVG.
export function SymbolShape({ symbolId, x, y, w, h, color, opacity, style, onClick }: {
  symbolId: SymbolId; x: number; y: number; w: number; h: number; color: string;
  opacity?: number; style?: React.CSSProperties; onClick?: () => void;
}) {
  const def = SYMBOL_DEFS[symbolId];
  return (
    <svg x={x} y={y} width={w} height={h} viewBox={`${def.bx} ${def.by} ${def.bw} ${def.bh}`}
      preserveAspectRatio="none" overflow="visible" opacity={opacity} style={style} onClick={onClick}>
      {/* Invisible hit area so thin symbols are easy to select or erase */}
      <rect x={def.bx} y={def.by} width={def.bw} height={def.bh} fill="transparent" />
      {def.fill
        ? <path d={def.d} fill={color} />
        : <path d={def.d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke"
            strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

// Small standalone icon for buttons.
export function SymbolIcon({ id, size = 22, color = 'currentColor' }: { id: SymbolId; size?: number; color?: string }) {
  const def = SYMBOL_DEFS[id];
  const pad = Math.max(def.bw, def.bh) * 0.08;
  return (
    <svg viewBox={`${def.bx - pad} ${def.by - pad} ${def.bw + 2 * pad} ${def.bh + 2 * pad}`}
      style={{ width: size * 1.6, height: size, display: 'block' }} aria-hidden="true">
      {def.fill
        ? <path d={def.d} fill={color} />
        : <path d={def.d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function SymbolButton({ id, active, onPick }: { id: SymbolId; active?: boolean; onPick: (id: SymbolId) => void }) {
  return (
    <button type="button" title={SYMBOL_LABELS[id]} aria-label={SYMBOL_LABELS[id]} onClick={() => onPick(id)}
      className={`rounded-lg flex items-center justify-center transition-colors ${active ? 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-300' : 'text-gray-700 hover:bg-black/[0.05]'}`}
      style={{ width: 44, height: 34 }}>
      <SymbolIcon id={id} size={18} />
    </button>
  );
}

// Full palette: recent symbols first, then every group.
export function SymbolGrid({ recent, active, onPick }: { recent: SymbolId[]; active?: SymbolId | null; onPick: (id: SymbolId) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {recent.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Recent</div>
          <div className="flex flex-wrap gap-0.5">
            {recent.map(id => <SymbolButton key={id} id={id} active={id === active} onPick={onPick} />)}
          </div>
        </div>
      )}
      {SYMBOL_GROUPS.map(g => (
        <div key={g.id}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{g.label}</div>
          <div className="flex flex-wrap gap-0.5">
            {g.symbols.map(id => <SymbolButton key={id} id={id} active={id === active} onPick={onPick} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// Floating palette at a screen position (right-click / long-press menu, or toolbar "More").
export default function SymbolPopover({ left, top, recent, active, onPick, onClose }: {
  left: number; top: number; recent: SymbolId[]; active?: SymbolId | null;
  onPick: (id: SymbolId) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Keep the popover inside the window.
  const W = 296, H = 420;
  const l = Math.max(8, Math.min(left, (typeof window !== 'undefined' ? window.innerWidth : 1200) - W - 8));
  const t = Math.max(8, Math.min(top, (typeof window !== 'undefined' ? window.innerHeight : 800) - H - 8));

  // Portal to <body> so blurred/transformed ancestors (toolbar) cannot offset `position: fixed`.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-label="Symbols" style={{
      position: 'fixed', left: l, top: t, zIndex: 60, width: W, maxHeight: H, overflowY: 'auto',
      background: 'white', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14,
      boxShadow: '0 12px 40px rgba(0,0,0,0.22)', padding: 10,
    }}>
      <SymbolGrid recent={recent} active={active} onPick={onPick} />
    </div>,
    document.body,
  );
}
