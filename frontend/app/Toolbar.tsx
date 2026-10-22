'use client';

import { useState } from 'react';


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
  onGoHome: () => void;
  onUndo: () => void;
  onClearAll: () => void;
  onToggleScrollSync: () => void;
  onToggleHand: () => void;
  onCopyLink: () => void;
  onPageChange: (page: number) => void;
  onToggleMetronome: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#1c1c1e'];
const STROKE_SIZES = [
  { label: 'Thin',   w: 2, dot: 5  },
  { label: 'Medium', w: 4, dot: 8  },
  { label: 'Thick',  w: 8, dot: 12 },
];
const ANNOTATE_TOOLS = [
  { id: 'pen',       label: 'Pen'       },
  { id: 'highlight', label: 'Highlight' },
  { id: 'ellipse',   label: 'Ellipse'   },
  { id: 'line',      label: 'Line'      },
  { id: 'text',      label: 'Text'      },
  { id: 'eraser',    label: 'Eraser'    },
  { id: 'select',    label: 'Select'    },
  { id: 'laser',     label: 'Laser'     },
];
const DRAW_TOOLS = new Set(['pen', 'highlight', 'ellipse', 'line', 'text']);

// ─── Icons ────────────────────────────────────────────────────────────────────

const ICONS: Record<string, React.ReactNode> = {
  select:    <path d="M5 3l14 7-6 2-2 6z" fill="currentColor" stroke="none" />,
  ellipse:   <ellipse cx="12" cy="12" rx="10" ry="6" />,
  pen:       (<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>),
  line:      <path d="M5 19 19 5" />,
  highlight: (<><path d="M9 11l-6 6v3h9l3-3" /><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></>),
  eraser:    (<><path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21" /><path d="M22 21H7" /></>),
  text:      (<><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>),
  laser:     (<><circle cx="12" cy="12" r="3" /><line x1="12" y1="2" x2="12" y2="7" /><line x1="12" y1="17" x2="12" y2="22" /><line x1="2" y1="12" x2="7" y2="12" /><line x1="17" y1="12" x2="22" y2="12" /></>),
  music:     (<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>),
  undo:      (<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H9" /></>),
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
      <button onClick={() => p.setActiveTool(id)} title={label}
        className={`w-9 h-9 rounded-lg ${base} ${
          laser  ? active ? 'bg-red-50 text-red-500' : 'text-gray-500 hover:bg-red-50 hover:text-red-500'
                 : active ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-800'
        }`}>
        <Icon name={id} />
      </button>
    );
  }

  function ColorRow() {
    return (
      <div className={`flex flex-wrap gap-1.5 ${p.pos !== 'top' ? 'px-2 pt-1' : ''}`}>
        {PRESET_COLORS.map(c => (
          <button key={c} onClick={() => p.setColor(c)}
            className="rounded-full transition-transform hover:scale-110 shrink-0"
            style={{ width: p.pos === 'top' ? 18 : 17, height: p.pos === 'top' ? 18 : 17 }}>
            <span className="block w-full h-full rounded-full" style={{
              backgroundColor: c,
              boxShadow: p.color === c ? `0 0 0 2px white, 0 0 0 3.5px ${c}` : 'inset 0 0 0 1px rgba(0,0,0,0.12)',
            }} />
          </button>
        ))}
        <label className="rounded-full cursor-pointer transition-transform hover:scale-110 shrink-0"
          style={{ width: p.pos === 'top' ? 18 : 17, height: p.pos === 'top' ? 18 : 17 }}>
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
    return (
      <div className={`flex items-center gap-0.5 ${p.pos !== 'top' ? 'px-2 pb-1' : ''}`}>
        {STROKE_SIZES.map(s => (
          <button key={s.label} onClick={() => p.setStrokeWidth(s.w)} title={s.label}
            className={`rounded-lg flex items-center justify-center transition-colors ${p.pos === 'top' ? 'w-7 h-7' : 'flex-1 h-7'} ${
              p.strokeWidth === s.w ? 'bg-black/[0.08]' : 'hover:bg-black/[0.04]'
            }`}>
            <span className="rounded-full bg-gray-600" style={{ width: s.dot, height: s.dot }} />
          </button>
        ))}
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
              className={`px-2.5 h-7 rounded-lg text-xs font-medium transition-colors ${
                p.eraserMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}>
              {m === 'stroke' ? 'Stroke' : 'Pixel'}
            </button>
          ))}
        </div>
      );
    }
    if (!isDraw) return null;
    if (p.pos === 'top') {
      return (
        <>
          <Divider />
          <ColorRow />
          <Divider />
          <StrokeRow />
        </>
      );
    }
    return (
      <div className="mx-2 mb-2 rounded-xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <ColorRow />
        <div className="mx-2 h-px bg-black/[0.05] my-1" />
        <StrokeRow />
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

  if (p.pos === 'top') {
    return (
      <div className="flex items-center select-none"
        style={{ height: 56, flexShrink: 0, width: '100%', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px) saturate(1.8)', borderBottom: '1px solid rgba(0,0,0,0.06)', animation: 'tbFadeIn 0.18s ease' }}>

        {/* LEFT: tools strip — compresses when narrow so the right side is never pushed off */}
        <div className="flex items-center gap-0.5 px-3 min-w-0" style={{ flex: '1 1 0', overflow: 'hidden' }}>
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

          <button onClick={p.onUndo} disabled={!p.canUndo} title="Undo"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-black/[0.04] hover:text-gray-800 disabled:opacity-30 transition-colors shrink-0">
            <Icon name="undo" />
          </button>
          <button onClick={p.onClearAll} title="Clear all"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0">
            <Icon name="trash" />
          </button>

          {p.numPages > 1 && (
            <>
              <Divider />
              <button onClick={() => p.onPageChange(p.currentPage - 1)} disabled={p.currentPage === 0}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-black/[0.04] disabled:opacity-30 transition-colors shrink-0">
                <Icon name="chevronL" />
              </button>
              <span className="text-xs font-medium text-gray-500 tabular-nums w-12 text-center select-none shrink-0">
                {p.currentPage + 1} / {p.numPages}
              </span>
              <button onClick={() => p.onPageChange(p.currentPage + 1)} disabled={p.currentPage >= p.numPages - 1}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-black/[0.04] disabled:opacity-30 transition-colors shrink-0">
                <Icon name="chevronR" />
              </button>
            </>
          )}

          <Divider />

          <button onClick={p.onToggleMetronome} title="Metronome"
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
              p.metronomePanelOpen ? 'bg-indigo-100 text-indigo-600' : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-800'
            }`}>
            <Icon name="metronome" />
          </button>
        </div>

        {/* RIGHT: room status — always visible, never shrinks */}
        <div className="flex items-center gap-1.5 px-3 shrink-0">
          {p.isHost ? (
            <>
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-100 rounded-full px-2.5 py-1 select-none">
                👑 Host
              </span>
              <span className="text-xs font-medium text-gray-500 bg-black/[0.03] border border-black/[0.07] rounded-full px-2.5 py-1 select-none">
                👥 {p.participantCount} in room
              </span>
              <button onClick={p.onToggleScrollSync}
                title={p.scrollSyncEnabled ? 'Scroll sync on' : 'Turn on scroll sync'}
                className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors ${
                  p.scrollSyncEnabled ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-black/[0.03] text-gray-500 hover:bg-black/[0.06]'
                }`}>
                <Icon name="sync" size={13} />
                Sync
              </button>
              {p.raisedHands.length > 0 && (
                <span className="text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-1 select-none">
                  ✋ {p.raisedHands.length}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-xs text-gray-400 font-medium select-none">Participant</span>
              <button onClick={p.onToggleHand}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors ${
                  p.handRaised ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-black/[0.04] text-gray-600 hover:bg-black/[0.07]'
                }`}>
                ✋ {p.handRaised ? 'Lower' : 'Raise Hand'}
              </button>
            </>
          )}

          <div className="w-px h-5 bg-black/[0.08] mx-0.5" />

          <button onClick={p.onCopyLink}
            className={`flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-colors ${
              p.copied ? 'bg-green-500 text-white' : 'bg-gray-900 text-white hover:bg-gray-700'
            }`}>
            <Icon name={p.copied ? 'check' : 'link'} size={15} />
            {p.copied ? 'Copied' : 'Share'}
          </button>

          <PosMenu />
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
                {p.participantCount > 0 && (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-gray-500">
                    <span className="text-sm">👥</span>
                    <span className="text-xs font-medium">{p.participantCount} in room</span>
                  </div>
                )}
                {p.raisedHands.length > 0 && (
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-amber-50 text-amber-700">
                    <span className="text-sm">✋</span>
                    <span className="text-xs font-medium">{p.raisedHands.length} raised</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 px-2 py-1.5 text-gray-400">
                  <span className="text-xs font-medium">Participant</span>
                </div>
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
