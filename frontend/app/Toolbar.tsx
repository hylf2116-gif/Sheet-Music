'use client';

import { useRef, useState } from 'react';
import type { SymbolId } from './symbols';
import { SYMBOL_LABELS } from './symbols';
import SymbolPopover, { SymbolIcon, type SymbolSize } from './SymbolPalette';


// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolbarPos = 'top' | 'left' | 'right';

export interface ToolbarProps {
  pos: ToolbarPos;
  onPosChange: (p: ToolbarPos) => void;
  activeTool: string;
  setActiveTool: (t: string) => void;
  eraserMode: 'stroke' | 'pixel';
  setEraserMode: (m: 'stroke' | 'pixel') => void;
  color: string;
  setColor: (c: string) => void;
  strokeWidth: number;
  setStrokeWidth: (w: number) => void;
  highlighterOpacity: number;
  setHighlighterOpacity: (o: number) => void;
  // Symbols tool
  activeSymbol: SymbolId;
  onPickSymbol: (id: SymbolId) => void;
  recentSymbols: SymbolId[];
  symbolSize: SymbolSize;
  setSymbolSize: (s: SymbolSize) => void;
  isHost: boolean;
  participantCount: number;
  scrollSyncEnabled: boolean;
  handRaised: boolean;
  raisedHands: string[];
  copied: boolean;
  metronomePanelOpen: boolean;
  currentPage: number;
  numPages: number;
  canUndo: boolean;
  canRedo: boolean;
  onRedo: () => void;
  onGoHome: () => void;
  onUndo: () => void;
  onClearAll: () => void;
  onToggleScrollSync: () => void;
  onToggleHand: () => void;
  onCopyLink: () => void;
  onPageChange: (page: number) => void;
  onToggleMetronome: () => void;
  onExportPDF: () => void;
  chatOpen: boolean;
  chatUnread: number;
  onToggleChat: () => void;
  thumbsOpen: boolean;
  onToggleThumbs: () => void;
  bookmarkActive: boolean;
  onToggleBookmark: () => void;
  nickname?: string;
  onRename?: () => void;
  onOpenHandsPanel?: () => void;
  // Phone layout: two rows (status + tools) with larger touch targets
  compact?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#1c1c1e'];
const STROKE_SIZES = [
  { label: 'Thin',   w: 2, dot: 5  },
  { label: 'Medium', w: 4, dot: 8  },
  { label: 'Thick',  w: 8, dot: 12 },
];
// Highlighter widths are much thicker than pen widths (screen pixels).
export const HIGHLIGHTER_SIZES = [
  { label: 'Thin',   w: 10, dot: 6  },
  { label: 'Medium', w: 18, dot: 10 },
  { label: 'Thick',  w: 30, dot: 14 },
];
const ANNOTATE_TOOLS = [
  { id: 'pen',       label: 'Pen'       },
  { id: 'highlight', label: 'Highlighter' },
  { id: 'ellipse',   label: 'Ellipse'   },
  { id: 'line',      label: 'Line'      },
  { id: 'text',      label: 'Text'      },
  { id: 'symbol',    label: 'Symbols'   },
  { id: 'eraser',    label: 'Eraser'    },
  { id: 'select',    label: 'Select'    },
  { id: 'laser',     label: 'Laser'     },
];
const DRAW_TOOLS = new Set(['pen', 'highlight', 'ellipse', 'line', 'text', 'symbol']);

// ─── Icons ────────────────────────────────────────────────────────────────────

const ICONS: Record<string, React.ReactNode> = {
  select:    <path d="M5 3l14 7-6 2-2 6z" fill="currentColor" stroke="none" />,
  ellipse:   <ellipse cx="12" cy="12" rx="10" ry="6" />,
  pen:       (<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>),
  line:      <path d="M5 19 19 5" />,
  highlight: (<><path d="M9 11l-6 6v3h9l3-3" /><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></>),
  eraser:    (<><path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21" /><path d="M22 21H7" /></>),
  symbol:    (<><path d="M4 18c3-9 13-9 16 0" /><circle cx="12" cy="16" r="1.6" fill="currentColor" stroke="none" /></>),
  text:      (<><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>),
  laser:     (<><circle cx="12" cy="12" r="3" /><line x1="12" y1="2" x2="12" y2="7" /><line x1="12" y1="17" x2="12" y2="22" /><line x1="2" y1="12" x2="7" y2="12" /><line x1="17" y1="12" x2="22" y2="12" /></>),
  music:     (<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>),
  undo:      (<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H9" /></>),
  redo:      (<><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H15" /></>),
  trash:     (<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6" /><path d="M14 11v6" /></>),
  link:      (<><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><path d="M8 12h8" /></>),
  check:     <path d="M20 6 9 17l-5-5" />,
  chevronL:  <path d="M15 18l-6-6 6-6" />,
  chevronR:  <path d="M9 18l6-6-6-6" />,
  chevronD:  <path d="M6 9l6 6 6-6" />,
  sync:      (<><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /></>),
  metronome: (<><path d="M12 22V8" /><path d="M5 22h14" /><path d="M9 8h6" /><path d="M12 4v4" /><path d="M8.5 15.5 12 8l3.5 7.5" /></>),
  layoutT:   (<><rect x="3" y="3" width="18" height="5" rx="1.5" /><rect x="3" y="11" width="18" height="10" rx="1.5" /></>),
  layoutL:   (<><rect x="3" y="3" width="6" height="18" rx="1.5" /><rect x="12" y="3" width="9" height="18" rx="1.5" /></>),
  layoutR:   (<><rect x="15" y="3" width="6" height="18" rx="1.5" /><rect x="3" y="3" width="9" height="18" rx="1.5" /></>),
  download:  (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>),
  chat:         <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  pages:        (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
  bookmark:     <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />,
  bookmarkFill: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="currentColor" />,
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size, flexShrink: 0 }}>
      {ICONS[name]}
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Toolbar(p: ToolbarProps) {
  const [showPosMenu, setShowPosMenu] = useState(false);
  // Full symbol palette opened from the "All" button (screen position of the popover).
  const [symbolPaletteAt, setSymbolPaletteAt] = useState<{ left: number; top: number } | null>(null);
  const allSymbolsBtnRef = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    annotate: false, navigate: false, room: false, tools: false,
  });

  const isAnnotate = ANNOTATE_TOOLS.some(t => t.id === p.activeTool);
  const isDraw     = DRAW_TOOLS.has(p.activeTool);
  const isCustom   = !PRESET_COLORS.includes(p.color);

  function toggle(k: string) { setCollapsed(prev => ({ ...prev, [k]: !prev[k] })); }

  // ── Shared atoms ────────────────────────────────────────────────────────────

  function ToolBtn({ id, label }: { id: string; label: string }) {
    const active = p.activeTool === id;
    const laser  = id === 'laser';
    const base   = 'transition-all duration-150 flex items-center justify-center';

    if (p.pos !== 'top') {
      return (
        <button onClick={() => p.setActiveTool(id)} title={label}
          className={`flex flex-col items-center gap-0.5 py-1.5 px-0.5 rounded-xl w-full ${base} ${
            laser  ? active ? 'bg-red-50 text-red-500' : 'text-gray-400 hover:bg-red-50 hover:text-red-400'
                   : active ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-black/[0.04] hover:text-gray-700'
          }`}>
          <Icon name={id} size={16} />
          <span className="text-[9px] font-medium leading-tight select-none">{label}</span>
        </button>
      );
    }
    return (
      <button onClick={() => p.setActiveTool(id)} title={label} aria-label={label}
        className={`${p.compact ? 'w-10 h-10' : 'w-9 h-9'} rounded-lg shrink-0 ${base} ${
          laser  ? active ? 'bg-red-50 text-red-500' : 'text-gray-500 hover:bg-red-50 hover:text-red-500'
                 : active ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-800'
        }`}>
        <Icon name={id} />
      </button>
    );
  }

  function ColorRow() {
    const dotSize = p.compact ? 26 : p.pos === 'top' ? 18 : 17;
    return (
      <div className={`flex ${p.compact ? 'gap-2.5' : 'gap-1.5'} ${p.pos === 'top' ? 'shrink-0' : 'flex-wrap px-2 pt-1'}`}>
        {PRESET_COLORS.map(c => (
          <button key={c} onClick={() => p.setColor(c)}
            className="rounded-full transition-transform hover:scale-110 shrink-0"
            style={{ width: dotSize, height: dotSize }}>
            <span className="block w-full h-full rounded-full" style={{
              backgroundColor: c,
              boxShadow: p.color === c ? `0 0 0 2px white, 0 0 0 3.5px ${c}` : 'inset 0 0 0 1px rgba(0,0,0,0.12)',
            }} />
          </button>
        ))}
        <label className="rounded-full cursor-pointer transition-transform hover:scale-110 shrink-0"
          style={{ width: dotSize, height: dotSize }}>
          <span className="block w-full h-full rounded-full" style={{
            background: isCustom ? p.color : 'conic-gradient(#ff3b30,#ff9500,#ffcc00,#34c759,#007aff,#af52de,#ff3b30)',
            boxShadow: isCustom ? `0 0 0 2px white, 0 0 0 3.5px ${p.color}` : 'inset 0 0 0 1px rgba(0,0,0,0.12)',
          }} />
          <input type="color" value={p.color} onChange={e => p.setColor(e.target.value)} className="absolute inset-0 opacity-0 w-0 h-0" />
        </label>
      </div>
    );
  }

  function StrokeRow() {
    const isHl = p.activeTool === 'highlight';
    const sizes = isHl ? HIGHLIGHTER_SIZES : STROKE_SIZES;
    return (
      <div className={`flex items-center gap-0.5 ${p.pos !== 'top' ? 'px-2 pb-1' : 'shrink-0'}`}>
        {sizes.map(s => (
          <button key={s.label} onClick={() => p.setStrokeWidth(s.w)} title={s.label}
            className={`rounded-lg flex items-center justify-center transition-colors shrink-0 ${p.compact ? 'w-10 h-10' : p.pos === 'top' ? 'w-7 h-7' : 'flex-1 h-7'} ${
              p.strokeWidth === s.w ? 'bg-black/[0.08]' : 'hover:bg-black/[0.04]'
            }`}>
            <span className={isHl ? 'rounded-sm' : 'rounded-full bg-gray-600'} style={{
              width: s.dot, height: s.dot,
              ...(isHl ? { backgroundColor: p.color, opacity: Math.max(p.highlighterOpacity, 0.25) } : {}),
            }} />
          </button>
        ))}
      </div>
    );
  }

  // Highlighter opacity slider (10%–90%).
  function OpacityRow() {
    return (
      <div className={`flex items-center gap-1.5 shrink-0 ${p.pos !== 'top' ? 'px-2 pb-1.5' : ''}`} title="Highlighter opacity">
        <span className="text-[10px] text-gray-500 select-none">Opacity</span>
        <input type="range" min={10} max={90} step={5} aria-label="Highlighter opacity"
          value={Math.round(p.highlighterOpacity * 100)}
          onChange={e => p.setHighlighterOpacity(Number(e.target.value) / 100)}
          className={p.pos === 'top' ? 'w-20' : 'flex-1 min-w-0'} style={{ accentColor: '#6366f1' }} />
        <span className="text-[10px] text-gray-500 w-7 text-right tabular-nums select-none">{Math.round(p.highlighterOpacity * 100)}%</span>
      </div>
    );
  }

  // Symbols tool controls: current + recent symbols, "All" palette, and S/M/L size.
  // Plain render function (not a component) so the popover state lives in Toolbar.
  function symbolRow() {
    const quick = [p.activeSymbol, ...p.recentSymbols.filter(s => s !== p.activeSymbol)].slice(0, 6);
    return (
      <div className={`flex items-center gap-0.5 ${p.pos !== 'top' ? 'flex-wrap px-2 pb-1.5' : 'shrink-0'}`}>
        {quick.map(id => (
          <button key={id} onClick={() => p.onPickSymbol(id)} title={SYMBOL_LABELS[id]} aria-label={SYMBOL_LABELS[id]}
            className={`h-7 px-1 rounded-lg flex items-center justify-center transition-colors ${
              id === p.activeSymbol ? 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-300' : 'text-gray-700 hover:bg-black/[0.05]'
            }`}>
            <SymbolIcon id={id} size={14} />
          </button>
        ))}
        <button ref={allSymbolsBtnRef} title="All symbols" aria-label="All symbols"
          onClick={() => {
            const r = allSymbolsBtnRef.current?.getBoundingClientRect();
            setSymbolPaletteAt(prev => prev ? null : { left: r ? r.left : 100, top: r ? r.bottom + 6 : 60 });
          }}
          className="h-7 px-2 rounded-lg text-xs font-medium text-gray-600 hover:bg-black/[0.05]">
          All
        </button>
        <div className={p.pos === 'top' ? 'w-px h-5 bg-black/[0.08] mx-1' : 'w-full h-px bg-black/[0.05] my-1'} />
        {(['S', 'M', 'L'] as const).map(s => (
          <button key={s} onClick={() => p.setSymbolSize(s)} title={`Size ${s}`}
            className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${
              p.symbolSize === s ? 'bg-black/[0.08] text-gray-900' : 'text-gray-500 hover:bg-black/[0.04]'
            }`}>
            {s}
          </button>
        ))}
        {symbolPaletteAt && (
          <SymbolPopover left={symbolPaletteAt.left} top={symbolPaletteAt.top}
            recent={p.recentSymbols} active={p.activeSymbol}
            onPick={id => { p.onPickSymbol(id); setSymbolPaletteAt(null); }}
            onClose={() => setSymbolPaletteAt(null)} />
        )}
      </div>
    );
  }

  // The context panel: color+stroke for draw tools, mode toggle for eraser
  function ContextPanel() {
    if (p.activeTool === 'eraser') {
      return (
        <div className={`flex items-center gap-0.5 ${p.pos !== 'top' ? 'mx-2 mb-2 rounded-xl overflow-hidden' : ''}`}
          style={{ background: p.pos !== 'top' ? 'rgba(0,0,0,0.04)' : undefined }}>
          {(['stroke', 'pixel'] as const).map(m => (
            <button key={m} onClick={() => p.setEraserMode(m)}
              className={`px-2.5 ${p.compact ? 'h-9 px-4 text-sm' : 'h-7'} rounded-lg text-xs font-medium transition-colors ${
                p.eraserMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}>
              {m === 'stroke' ? 'Stroke' : 'Pixel'}
            </button>
          ))}
        </div>
      );
    }
    if (!isDraw) return null;
    if (p.activeTool === 'symbol') {
      return p.pos === 'top'
        ? (<><Divider /><ColorRow /><Divider />{symbolRow()}</>)
        : (
          <div className="mx-2 mb-2 rounded-xl" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.05)' }}>
            <ColorRow />
            <div className="mx-2 h-px bg-black/[0.05] my-1" />
            {symbolRow()}
          </div>
        );
    }
    if (p.pos === 'top') {
      return (
        <>
          <Divider />
          <ColorRow />
          <Divider />
          <StrokeRow />
          {p.activeTool === 'highlight' && (<><Divider /><OpacityRow /></>)}
        </>
      );
    }
    return (
      <div className="mx-2 mb-2 rounded-xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <ColorRow />
        <div className="mx-2 h-px bg-black/[0.05] my-1" />
        <StrokeRow />
        {p.activeTool === 'highlight' && <OpacityRow />}
      </div>
    );
  }

  function Divider() {
    return p.pos === 'top'
      ? <div className="w-px h-5 bg-black/[0.08] mx-1 shrink-0" />
      : <div className="h-px bg-black/[0.05] mx-3 my-1" />;
  }

  // ── Position toggle menu ──────────────────────────────────────────────────

  const posIcons: Record<ToolbarPos, string> = { top: 'layoutT', left: 'layoutL', right: 'layoutR' };
  const posLabels: Record<ToolbarPos, string> = { top: 'Top bar', left: 'Left sidebar', right: 'Right sidebar' };

  function PosMenu() {
    return (
      <div className="relative">
        <button onClick={() => setShowPosMenu(v => !v)} title="Toolbar position"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-black/[0.04] transition-colors">
          <Icon name={posIcons[p.pos]} size={14} />
        </button>
        {showPosMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowPosMenu(false)} />
            <div className={`absolute z-50 rounded-2xl shadow-xl py-1.5 overflow-hidden ${
              p.pos === 'top' ? 'top-full right-0 mt-1.5' : p.pos === 'left' ? 'left-full bottom-0 ml-2' : 'right-full bottom-0 mr-2'
            }`} style={{ background: 'white', border: '1px solid rgba(0,0,0,0.08)', minWidth: 172, backdropFilter: 'blur(20px)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-3 pt-1 pb-1.5">Toolbar position</p>
              {(['top', 'left', 'right'] as ToolbarPos[]).map(opt => (
                <button key={opt}
                  onClick={() => { p.onPosChange(opt); setShowPosMenu(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                    p.pos === opt ? 'bg-indigo-50 text-indigo-600' : 'text-gray-700 hover:bg-gray-50'
                  }`}>
                  <Icon name={posIcons[opt]} size={14} />
                  <span>{posLabels[opt]}</span>
                  {p.pos === opt && <span className="ml-auto text-indigo-400">✓</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Sidebar section header ────────────────────────────────────────────────

  function SectionHeader({ id, label }: { id: string; label: string }) {
    return (
      <button onClick={() => toggle(id)}
        className="w-full flex items-center justify-between px-3 py-1.5 group select-none">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 group-hover:text-gray-600 transition-colors">{label}</span>
        <Icon name="chevronD" size={11} />
      </button>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOP BAR
  // ─────────────────────────────────────────────────────────────────────────

  if (p.pos === 'top' && p.compact) {
    const iconBtn = 'w-10 h-10 rounded-lg flex items-center justify-center text-gray-600 active:bg-black/[0.06] disabled:opacity-30 transition-colors shrink-0';
    const contextRow = isAnnotate && (isDraw || p.activeTool === 'eraser');
    return (
      <div className="flex flex-col select-none shrink-0"
        style={{ width: '100%', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px) saturate(1.8)', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Row 1: home, room status, share */}
        <div className="flex items-center gap-1 px-2" style={{ height: 48 }}>
          <button onClick={p.onGoHome} aria-label="Home" className={`${iconBtn} text-indigo-600`}>
            <Icon name="music" size={19} />
          </button>
          {p.nickname && (
            <button onClick={p.onRename} title="Change name"
              className="text-xs text-gray-500 rounded-md px-1.5 py-1 truncate min-w-0 max-w-[110px]">
              {p.isHost ? '👑 ' : ''}{p.nickname}
            </button>
          )}
          <span className="text-[11px] text-gray-400 tabular-nums shrink-0">👥 {p.participantCount}</span>
          <div className="flex-1" />
          {p.isHost ? (
            <>
              <button onClick={p.onToggleScrollSync} aria-label={p.scrollSyncEnabled ? 'Scroll sync on' : 'Scroll sync off'}
                className={`${iconBtn} ${p.scrollSyncEnabled ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400'}`}>
                <Icon name="sync" size={16} />
              </button>
              {p.raisedHands.length > 0 && (
                <button onClick={p.onOpenHandsPanel}
                  className="text-xs font-semibold text-amber-700 bg-amber-100 rounded-full px-2 py-1 shrink-0">
                  ✋{p.raisedHands.length}
                </button>
              )}
            </>
          ) : (
            <button onClick={p.onToggleHand} aria-label={p.handRaised ? 'Lower hand' : 'Raise hand'}
              className={`h-9 px-2.5 rounded-lg text-sm shrink-0 ${p.handRaised ? 'bg-amber-100 text-amber-700' : 'text-gray-500'}`}>
              ✋{p.handRaised ? ' Lower' : ''}
            </button>
          )}
          <button onClick={p.onCopyLink} aria-label="Copy share link"
            className={`flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium shrink-0 ${
              p.copied ? 'bg-green-500 text-white' : 'bg-gray-900 text-white'
            }`}>
            <Icon name={p.copied ? 'check' : 'link'} size={15} />
            {p.copied ? 'Copied' : 'Share'}
          </button>
        </div>
        {/* Row 2: tools (swipe sideways for more) + undo/redo/clear */}
        <div className="flex items-center gap-0.5 px-2 overflow-x-auto no-scrollbar" style={{ height: 50, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
          {ANNOTATE_TOOLS.map(t => <ToolBtn key={t.id} id={t.id} label={t.label} />)}
          <Divider />
          <button onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo" className={iconBtn}><Icon name="undo" size={18} /></button>
          <button onClick={p.onRedo} disabled={!p.canRedo} aria-label="Redo" className={iconBtn}><Icon name="redo" size={18} /></button>
          <button onClick={p.onClearAll} aria-label="Clear all" className={`${iconBtn} hover:text-red-500`}><Icon name="trash" size={18} /></button>
        </div>
        {/* Row 3: options for the current tool */}
        {contextRow && (
          <div className="flex items-center gap-1 px-3 overflow-x-auto no-scrollbar" style={{ height: 48, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
            <ContextPanel />
          </div>
        )}
      </div>
    );
  }

  if (p.pos === 'top') {
    return (
      <div className="flex flex-col select-none shrink-0"
        style={{ width: '100%', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px) saturate(1.8)', borderBottom: '1px solid rgba(0,0,0,0.06)', animation: 'tbFadeIn 0.18s ease' }}>

        {/* ── Main bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center" style={{ height: 52 }}>

          {/* LEFT: logo + annotation tools + undo/clear + page nav */}
          {/* On narrower screens (iPad portrait) this part scrolls sideways instead of cutting tools off */}
          <div className="flex items-center gap-0.5 px-3 min-w-0 overflow-x-auto no-scrollbar" style={{ flex: '1 1 0' }}>
            <button onClick={p.onGoHome}
              className="flex items-center gap-2 pl-1 pr-3 h-9 rounded-lg text-gray-800 hover:bg-black/[0.04] transition-colors shrink-0">
              <Icon name="music" size={17} />
              <span className="text-sm font-semibold tracking-tight text-indigo-600">Unino</span>
            </button>

            <Divider />

            <div className="flex items-center gap-0.5 shrink-0">
              {ANNOTATE_TOOLS.map(t => <ToolBtn key={t.id} id={t.id} label={t.label} />)}
            </div>

            {isAnnotate && <ContextPanel />}

            <Divider />

            <button onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Cmd/Ctrl+Z)"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-black/[0.04] hover:text-gray-800 disabled:opacity-30 transition-colors shrink-0">
              <Icon name="undo" size={16} />
            </button>
            <button onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Shift+Cmd/Ctrl+Z)"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-black/[0.04] hover:text-gray-800 disabled:opacity-30 transition-colors shrink-0">
              <Icon name="redo" size={16} />
            </button>
            <button onClick={p.onClearAll} title="Clear all"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0">
              <Icon name="trash" size={16} />
            </button>

            {p.numPages > 1 && (
              <>
                <Divider />
                <button onClick={() => p.onPageChange(p.currentPage - 1)} disabled={p.currentPage === 0}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-black/[0.04] disabled:opacity-30 transition-colors shrink-0">
                  <Icon name="chevronL" />
                </button>
                <span className="text-xs font-medium text-gray-500 tabular-nums w-11 text-center select-none shrink-0">
                  {p.currentPage + 1} / {p.numPages}
                </span>
                <button onClick={() => p.onPageChange(p.currentPage + 1)} disabled={p.currentPage >= p.numPages - 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-black/[0.04] disabled:opacity-30 transition-colors shrink-0">
                  <Icon name="chevronR" />
                </button>
              </>
            )}
          </div>

          {/* RIGHT: minimal room status + share + pos menu */}
          <div className="flex items-center gap-1 px-3 shrink-0">
            {p.isHost ? (
              <>
                <span className="text-[11px] font-semibold text-amber-600 select-none px-1.5 py-0.5 rounded-md bg-amber-50 border border-amber-100 shrink-0">👑</span>
                {p.nickname && (
                  <button onClick={p.onRename} title="Change name"
                    className="text-[11px] text-gray-500 hover:text-gray-800 hover:bg-black/[0.04] rounded-md px-1.5 py-0.5 transition-colors shrink-0 max-w-[90px] truncate">
                    {p.nickname}
                  </button>
                )}
                <span className="text-[11px] text-gray-400 select-none tabular-nums shrink-0">{p.participantCount}</span>
                <button onClick={p.onToggleScrollSync} title={p.scrollSyncEnabled ? 'Scroll sync on' : 'Scroll sync off'}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                    p.scrollSyncEnabled ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400 hover:text-gray-700 hover:bg-black/[0.04]'
                  }`}>
                  <Icon name="sync" size={13} />
                </button>
                {p.raisedHands.length > 0 && (
                  <button onClick={p.onOpenHandsPanel}
                    className="text-[10px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-full px-1.5 py-0.5 select-none shrink-0 transition-colors">
                    ✋{p.raisedHands.length}
                  </button>
                )}
              </>
            ) : (
              <>
                <button onClick={p.onToggleHand}
                  className={`flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] font-medium transition-colors shrink-0 ${
                    p.handRaised ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-700'
                  }`}>
                  ✋ {p.handRaised ? 'Lower' : 'Raise hand'}
                </button>
                {p.nickname && (
                  <button onClick={p.onRename} title="Change name"
                    className="text-[11px] text-gray-500 hover:text-gray-800 hover:bg-black/[0.04] rounded-md px-1.5 py-0.5 transition-colors shrink-0 max-w-[90px] truncate">
                    {p.nickname}
                  </button>
                )}
              </>
            )}

            <div className="w-px h-4 bg-black/[0.08] mx-1 shrink-0" />

            <button onClick={p.onCopyLink}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium transition-colors shrink-0 ${
                p.copied ? 'bg-green-500 text-white' : 'bg-gray-900 text-white hover:bg-gray-700'
              }`}>
              <Icon name={p.copied ? 'check' : 'link'} size={14} />
              {p.copied ? 'Copied' : 'Share'}
            </button>

            <PosMenu />
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LEFT / RIGHT SIDEBAR
  // ─────────────────────────────────────────────────────────────────────────

  const borderSide = p.pos === 'left' ? 'borderRight' : 'borderLeft';

  return (
    <div className="flex flex-col select-none"
      style={{
        width: 192,
        flexShrink: 0,
        alignSelf: 'stretch',
        background: 'rgba(255,255,255,0.88)',
        backdropFilter: 'blur(20px) saturate(1.8)',
        [borderSide]: '1px solid rgba(0,0,0,0.07)',
        animation: 'tbFadeIn 0.18s ease',
      }}>

      {/* Logo */}
      <button onClick={p.onGoHome}
        className="flex items-center gap-2.5 px-4 h-14 shrink-0 text-gray-800 hover:bg-black/[0.03] transition-colors"
        style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <Icon name="music" size={17} />
        <span className="text-sm font-semibold tracking-tight text-indigo-600">Unino</span>
      </button>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto py-2">

        {/* ── ANNOTATE ── */}
        <SectionHeader id="annotate" label="Annotate" />
        {!collapsed.annotate && (
          <div className="px-2 pb-1">
            <div className="grid grid-cols-4 gap-0.5">
              {ANNOTATE_TOOLS.map(t => <ToolBtn key={t.id} id={t.id} label={t.label} />)}
            </div>
            {isAnnotate && (
              <div className="mt-1">
                <ContextPanel />
              </div>
            )}
          </div>
        )}

        <Divider />

        {/* ── NAVIGATE ── */}
        <SectionHeader id="navigate" label="Navigate" />
        {!collapsed.navigate && (
          <div className="px-2 pb-1 flex flex-col gap-0.5">
            {/* Page navigation */}
            {p.numPages > 1 ? (
              <div className="flex items-center gap-1 px-1">
                <button onClick={() => p.onPageChange(p.currentPage - 1)} disabled={p.currentPage === 0}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-black/[0.04] disabled:opacity-30 transition-colors">
                  <Icon name="chevronL" size={15} />
                </button>
                <span className="flex-1 text-center text-xs font-medium text-gray-500 tabular-nums select-none">
                  {p.currentPage + 1} / {p.numPages}
                </span>
                <button onClick={() => p.onPageChange(p.currentPage + 1)} disabled={p.currentPage >= p.numPages - 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-black/[0.04] disabled:opacity-30 transition-colors">
                  <Icon name="chevronR" size={15} />
                </button>
              </div>
            ) : (
              <p className="text-[10px] text-gray-400 px-2 py-1">Single page</p>
            )}
            {/* Undo / Clear */}
            <SideRow icon="undo" label="Undo" disabled={!p.canUndo} onClick={p.onUndo} />
            <SideRow icon="redo" label="Redo" disabled={!p.canRedo} onClick={p.onRedo} />
            <SideRow icon="trash" label="Clear all" danger onClick={p.onClearAll} />
            {/* Scroll sync (host only) */}
            {p.isHost && (
              <button onClick={p.onToggleScrollSync}
                className={`flex items-center gap-2.5 px-2 py-2 rounded-xl text-sm transition-colors ${
                  p.scrollSyncEnabled ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-800'
                }`}>
                <Icon name="sync" size={15} />
                <span className="text-xs font-medium">Scroll sync {p.scrollSyncEnabled ? 'ON' : 'OFF'}</span>
              </button>
            )}
            {/* Thumbnails */}
            <button onClick={p.onToggleThumbs}
              className={`flex items-center gap-2.5 w-full px-2 py-2 rounded-xl text-sm transition-colors ${
                p.thumbsOpen ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-800'
              }`}>
              <Icon name="pages" size={15} />
              <span className="text-xs font-medium">Thumbnails</span>
            </button>
            {/* Bookmark current page */}
            <button onClick={p.onToggleBookmark}
              className={`flex items-center gap-2.5 w-full px-2 py-2 rounded-xl text-sm transition-colors ${
                p.bookmarkActive ? 'bg-amber-50 text-amber-600' : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-800'
              }`}>
              <Icon name={p.bookmarkActive ? 'bookmarkFill' : 'bookmark'} size={15} />
              <span className="text-xs font-medium">{p.bookmarkActive ? 'Bookmarked' : 'Bookmark page'}</span>
            </button>
          </div>
        )}

        <Divider />

        {/* ── ROOM ── */}
        <SectionHeader id="room" label="Room" />
        {!collapsed.room && (
          <div className="px-2 pb-1 flex flex-col gap-0.5">
            {p.isHost ? (
              <>
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className="text-sm">👑</span>
                  <span className="text-xs font-semibold text-amber-600">Host</span>
                </div>
                {p.nickname && (
                  <button onClick={p.onRename}
                    className="flex items-center gap-2 px-2 py-1.5 w-full rounded-xl text-left text-gray-500 hover:bg-black/[0.04] hover:text-gray-800 transition-colors">
                    <span className="text-xs font-medium truncate">{p.nickname}</span>
                    <span className="text-[10px] text-gray-400 ml-auto shrink-0">rename</span>
                  </button>
                )}
                {p.participantCount > 0 && (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-gray-500">
                    <span className="text-sm">👥</span>
                    <span className="text-xs font-medium">{p.participantCount} in room</span>
                  </div>
                )}
                {p.raisedHands.length > 0 && (
                  <button onClick={p.onOpenHandsPanel}
                    className="flex items-center gap-2 px-2 py-1.5 w-full rounded-xl bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors">
                    <span className="text-sm">✋</span>
                    <span className="text-xs font-medium">{p.raisedHands.length} raised</span>
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 px-2 py-1.5 text-gray-400">
                  <span className="text-xs font-medium">Participant</span>
                </div>
                {p.nickname && (
                  <button onClick={p.onRename}
                    className="flex items-center gap-2 px-2 py-1.5 w-full rounded-xl text-left text-gray-500 hover:bg-black/[0.04] hover:text-gray-800 transition-colors">
                    <span className="text-xs font-medium truncate">{p.nickname}</span>
                    <span className="text-[10px] text-gray-400 ml-auto shrink-0">rename</span>
                  </button>
                )}
                <button onClick={p.onToggleHand}
                  className={`flex items-center gap-2.5 px-2 py-2 rounded-xl text-sm transition-colors ${
                    p.handRaised ? 'bg-amber-50 text-amber-700' : 'text-gray-500 hover:bg-black/[0.04]'
                  }`}>
                  <span>✋</span>
                  <span className="text-xs font-medium">{p.handRaised ? 'Lower hand' : 'Raise hand'}</span>
                </button>
              </>
            )}
          </div>
        )}

        <Divider />

        {/* ── TOOLS ── */}
        <SectionHeader id="tools" label="Tools" />
        {!collapsed.tools && (
          <div className="px-2 pb-1">
            <button onClick={p.onToggleMetronome}
              className={`flex items-center gap-2.5 w-full px-2 py-2 rounded-xl text-sm transition-colors ${
                p.metronomePanelOpen ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-800'
              }`}>
              <Icon name="metronome" size={15} />
              <span className="text-xs font-medium">Metronome</span>
            </button>
            <button onClick={p.onExportPDF}
              className="flex items-center gap-2.5 w-full px-2 py-2 rounded-xl text-sm text-gray-500 hover:bg-black/[0.04] hover:text-gray-800 transition-colors">
              <Icon name="download" size={15} />
              <span className="text-xs font-medium">Export PDF</span>
            </button>
            <div className="relative">
              <button onClick={p.onToggleChat}
                className={`flex items-center gap-2.5 w-full px-2 py-2 rounded-xl text-sm transition-colors ${
                  p.chatOpen ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-800'
                }`}>
                <Icon name="chat" size={15} />
                <span className="text-xs font-medium">Chat</span>
              </button>
              {p.chatUnread > 0 && !p.chatOpen && (
                <span className="absolute top-1.5 right-2 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center leading-none pointer-events-none">
                  {p.chatUnread > 9 ? '9+' : p.chatUnread}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-3 py-3 flex items-center gap-2"
        style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <button onClick={p.onCopyLink}
          className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-semibold transition-colors ${
            p.copied ? 'bg-green-500 text-white' : 'bg-gray-900 text-white hover:bg-gray-700'
          }`}>
          <Icon name={p.copied ? 'check' : 'link'} size={13} />
          {p.copied ? 'Copied!' : 'Share'}
        </button>
        <PosMenu />
      </div>
    </div>
  );
}

// ── Small helper for sidebar row buttons ─────────────────────────────────────

function SideRow({ icon, label, onClick, disabled, danger }: {
  icon: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  const ICONS_LOCAL: Record<string, React.ReactNode> = {
    undo:  (<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H9" /></>),
    trash: (<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6" /><path d="M14 11v6" /></>),
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-2.5 px-2 py-2 rounded-xl w-full text-sm transition-colors disabled:opacity-30 ${
        danger ? 'text-gray-500 hover:bg-red-50 hover:text-red-500' : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-800'
      }`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
        strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
        {ICONS_LOCAL[icon]}
      </svg>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
