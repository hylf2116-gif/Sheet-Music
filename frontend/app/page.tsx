'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { BACKEND_URL, backendUrl, resolvePdfUrl } from '../lib/config';
import PDFViewer from './PDFViewer';
import MetronomePanel, { type MetronomeState } from './MetronomePanel';
import Toolbar, { type ToolbarPos } from './Toolbar';
import AuthModal from './AuthModal';
import Sidebar from './Sidebar';
import { exportAnnotatedPDF, buildSuggestedFilename } from './exportAnnotatedPDF';
import ExportModal from './ExportModal';
import LayersPopover, { type LayerOwner } from './LayersPopover';
import NicknameModal from './NicknameModal';
import RaisedHandsPanel from './RaisedHandsPanel';
import { upsertSession, fetchRecentSessions, type RecentSession } from '../lib/sessions';
import AccountPanel, { type PanelTab, type Theme } from './AccountPanel';
import IMSLPPanel from './IMSLPPanel';
import GuestSettings from './GuestSettings';
import ColorModePicker, { loadColorMode, COLOR_MODE_KEY, type ColorMode } from './ColorModePicker';
import ChatPanel, { type ChatMessage } from './ChatPanel';
import ThumbnailPanel from './ThumbnailPanel';
import TunerPanel from './TunerPanel';
import PitchTrace, { type RemotePitchEntry } from './PitchTrace';
import { usePitch } from '../hooks/usePitch';
import type { InstrumentKey } from '../lib/pitch';
import SymbolPopover, { SYMBOL_SIZE_FACTOR, DEFAULT_SYMBOL_EM, makeSymbolAnnotation, isSymbolId, type SymbolSize } from './SymbolPalette';
import type { SymbolId } from './symbols';
import { usePhone, useNarrow } from './useMediaQuery';
import OMRPanel, { type OmrState, type OmrPrefs, type OmrMeasure, DEFAULT_OMR_PREFS } from './OMRPanel';
import { useT, type TFunc } from '../lib/i18n';

const OMR_PREFS_KEY = 'unino_omr_prefs';

// One recorded change for undo/redo. `ann` / `before` / `after` hold full data so the
// change can be replayed in both directions.
type HistoryOp =
  | { kind: 'add'; ann: any }
  | { kind: 'delete'; ann: any }
  | { kind: 'update'; id: string; before: any; after: any };

const socket = io(BACKEND_URL);
const POS_KEY = 'unino_toolbar_pos';

function getOrCreateClientId(): string {
  try {
    const stored = localStorage.getItem('unino_client_id');
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem('unino_client_id', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
const OWNER_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16'];

// ── Floating action cluster icons ─────────────────────────────────────────────
const FC_ICONS: Record<string, React.ReactNode> = {
  more: (<><circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" /></>),
  pages:        (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
  chat:         <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  metronome:    (<><path d="M12 22V8" /><path d="M5 22h14" /><path d="M9 8h6" /><path d="M12 4v4" /><path d="M8.5 15.5 12 8l3.5 7.5" /></>),
  bookmark:     <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />,
  bookmarkFill: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="currentColor" />,
  download:     (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>),
  tuner:        (<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>),
  pitchlive:    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  measures:     (<><rect x="3" y="5" width="18" height="14" rx="1" /><line x1="9" y1="5" x2="9" y2="19" /><line x1="15" y1="5" x2="15" y2="19" /></>),
  layers:       (<><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>),
};

interface FloatingClusterProps {
  thumbsOpen: boolean; onToggleThumbs: () => void;
  chatOpen: boolean; chatUnread: number; onToggleChat: () => void;
  metronomePanelOpen: boolean; onToggleMetronome: () => void;
  bookmarkActive: boolean; onToggleBookmark: () => void;
  tunerOpen: boolean; onToggleTuner: () => void;
  pitchLiveOpen: boolean; onTogglePitchLive: () => void;
  layersOpen: boolean; hasHiddenLayers: boolean; onToggleLayers: () => void;
  omrOpen: boolean; omrRunning: boolean; onToggleOmr: () => void;
  onExportPDF: () => void;
  rightOffset: number;
}

// One button of the floating cluster. Module-level so React keeps it stable between renders.
function FBtn({ icon, active, onClick, title, amber, badge, dot }: {
  icon: string; active: boolean; onClick: () => void; title: string; amber?: boolean; badge?: number; dot?: boolean;
}) {
    return (
      <div style={{ position: 'relative' }}>
        <button onClick={onClick} title={title} style={{
          width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s, color 0.15s',
          background: active
            ? (amber ? 'rgba(245,158,11,0.22)' : 'rgba(99,102,241,0.22)')
            : 'transparent',
          color: active
            ? (amber ? '#fbbf24' : '#818cf8')
            : 'rgba(255,255,255,0.55)',
        }}
          onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
          onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
            strokeLinecap="round" strokeLinejoin="round" style={{ width: 17, height: 17 }}>
            {FC_ICONS[icon]}
          </svg>
        </button>
        {badge != null && badge > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0, width: 14, height: 14,
            background: '#ef4444', borderRadius: 7, fontSize: 9, fontWeight: 700,
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            {badge > 9 ? '9+' : badge}
          </span>
        )}
        {dot && (
          <span style={{
            position: 'absolute', top: 2, right: 2, width: 7, height: 7,
            background: '#f59e0b', borderRadius: 4, border: '1.5px solid rgba(18,18,26,0.84)',
            pointerEvents: 'none',
          }} />
        )}
      </div>
    );
}

function FloatingCluster(p: FloatingClusterProps & { compact?: boolean }) {
  const t = useT();
  // On phones the cluster folds into one "more" button in the bottom-right corner.
  const [open, setOpen] = useState(false);
  if (p.compact && !open) {
    return (
      <div style={{
        position: 'fixed', right: 12, bottom: 'calc(16px + env(safe-area-inset-bottom))', zIndex: 40,
        background: 'rgba(18,18,26,0.84)', backdropFilter: 'blur(18px) saturate(1.6)',
        borderRadius: 14, padding: 6, border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 8px 32px rgba(0,0,0,0.32)',
      }}>
        <FBtn icon="more" active={false} onClick={() => setOpen(true)} title={t('More tools')}
          badge={p.chatOpen ? 0 : p.chatUnread} />
      </div>
    );
  }
  return (
    <div onClick={p.compact ? () => setOpen(false) : undefined} style={{
      position: 'fixed', right: p.compact ? 12 : p.rightOffset,
      ...(p.compact ? { bottom: 'calc(16px + env(safe-area-inset-bottom))' } : { top: '50%', transform: 'translateY(-50%)' }),
      transition: 'right 0.2s ease',
      zIndex: 40, display: 'flex', flexDirection: 'column', gap: 2,
      background: 'rgba(18,18,26,0.84)', backdropFilter: 'blur(18px) saturate(1.6)',
      borderRadius: 14, padding: 6, border: '1px solid rgba(255,255,255,0.09)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.32)',
    }}>
      <FBtn icon="pages"     active={p.thumbsOpen}          onClick={p.onToggleThumbs}      title={t('Page thumbnails')} />
      <FBtn icon="chat"      active={p.chatOpen}            onClick={p.onToggleChat}         title={t('Chat')} badge={p.chatOpen ? 0 : p.chatUnread} />
      <FBtn icon="metronome" active={p.metronomePanelOpen}  onClick={p.onToggleMetronome}    title={t('Metronome')} />
      <FBtn icon={p.bookmarkActive ? 'bookmarkFill' : 'bookmark'} active={p.bookmarkActive} onClick={p.onToggleBookmark} title={p.bookmarkActive ? t('Remove bookmark') : t('Bookmark this page')} amber />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 2px' }} />
      <FBtn icon="tuner"     active={p.tunerOpen}           onClick={p.onToggleTuner}        title={t('Tuner')} />
      <FBtn icon="pitchlive" active={p.pitchLiveOpen}       onClick={p.onTogglePitchLive}    title={t('Live Pitch')} />
      <FBtn icon="layers"    active={p.layersOpen}          onClick={p.onToggleLayers}       title={t('Annotation layers')} dot={p.hasHiddenLayers} />
      <FBtn icon="measures"  active={p.omrOpen}             onClick={p.onToggleOmr}          title={t('Measures (bar numbers, highlight, jump)')} dot={p.omrRunning} />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 2px' }} />
      <FBtn icon="download"  active={false}                 onClick={p.onExportPDF}          title={t('Export PDF')} />
      {p.compact && <FBtn icon="more" active onClick={() => setOpen(false)} title={t('Close')} />}
    </div>
  );
}

function relativeTime(iso: string, t: TFunc): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t('Just now');
  if (mins < 60) return t('{n}m ago', { n: mins });
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return t('{n}h ago', { n: hours });
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return t('Yesterday');
  if (days < 7) return t('{n} days ago', { n: days });
  return new Date(iso).toLocaleDateString(t('en-US'), { month: 'short', day: 'numeric' });
}

export default function Home() {
  const t = useT();
  // Socket handlers are set up once; they read the current language through this ref.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const [stage, setStage] = useState<'home' | 'room'>('home');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [activeTool, setActiveTool] = useState('pen');
  const [eraserMode, setEraserMode] = useState<'stroke' | 'pixel'>('stroke');
  const [color, setColor] = useState('#ff3b30');
  const [strokeWidth, setStrokeWidth] = useState(4);
  // Highlighter has its own color, width and opacity (remembered per browser).
  const [hl, setHl] = useState({ color: '#ffcc00', width: 18, opacity: 0.4 });
  useEffect(() => {
    try {
      const raw = localStorage.getItem('unino_highlighter');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load saved settings after mount (localStorage is not available during server render)
      if (raw) setHl(prev => ({ ...prev, ...JSON.parse(raw) }));
    } catch {}
  }, []);
  // ── Music symbols ──
  const [activeSymbol, setActiveSymbol] = useState<SymbolId>('downBow');
  const [symbolSize, setSymbolSizeState] = useState<SymbolSize>('M');
  const [recentSymbols, setRecentSymbols] = useState<SymbolId[]>([]);
  // Right-click / long-press menu: where it opened (page coords) and where to show it (screen coords).
  const [symbolMenu, setSymbolMenu] = useState<{ page: number; x: number; y: number; asp: number; clientX: number; clientY: number } | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('unino_symbols') || '{}');
      const recent = Array.isArray(saved.recent) ? saved.recent.filter(isSymbolId).slice(0, 8) : [];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load saved settings after mount (localStorage is not available during server render)
      setRecentSymbols(recent);
      if (isSymbolId(saved.active)) setActiveSymbol(saved.active);
      if (saved.size === 'S' || saved.size === 'M' || saved.size === 'L') setSymbolSizeState(saved.size);
    } catch {}
  }, []);
  function saveSymbolPrefs(changes: { recent?: SymbolId[]; active?: SymbolId; size?: SymbolSize }) {
    try {
      const saved = JSON.parse(localStorage.getItem('unino_symbols') || '{}');
      localStorage.setItem('unino_symbols', JSON.stringify({ ...saved, ...changes }));
    } catch {}
  }
  function rememberSymbol(id: SymbolId) {
    setRecentSymbols(prev => {
      const next = [id, ...prev.filter(s => s !== id)].slice(0, 8);
      saveSymbolPrefs({ recent: next });
      return next;
    });
  }
  function pickSymbol(id: SymbolId) {
    setActiveSymbol(id);
    saveSymbolPrefs({ active: id });
  }
  function setSymbolSize(s: SymbolSize) {
    setSymbolSizeState(s);
    saveSymbolPrefs({ size: s });
  }

  function updateHl(changes: Partial<typeof hl>) {
    setHl(prev => {
      const next = { ...prev, ...changes };
      try { localStorage.setItem('unino_highlighter', JSON.stringify(next)); } catch {}
      return next;
    });
  }
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  // Undo/redo history. Each entry is a group of changes undone/redone together
  // (one drawing = one group; one whole eraser swipe = one group).
  const [undoStack, setUndoStack] = useState<HistoryOp[][]>([]);
  const [redoStack, setRedoStack] = useState<HistoryOp[][]>([]);
  // While an eraser swipe is in progress, changes are collected here instead of each
  // becoming its own undo step.
  const historyBatchRef = useRef<HistoryOp[] | null>(null);
  // Latest known annotation by id, including ones added moments ago that React state
  // has not rendered yet (an eraser swipe can add a piece and delete it again quickly).
  const knownAnnotationsRef = useRef<Map<string, any>>(new Map());

  // Identity & role
  const [myClientId] = useState(() => getOrCreateClientId());
  const [mySocketId, setMySocketId] = useState('');
  const [isHost, setIsHost] = useState(false);
  // ── Color by person ──
  // Choice for the next room this browser creates (remembered).
  const [newRoomColorMode, setNewRoomColorMode] = useState<ColorMode>('free');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load saved choice after mount (localStorage is not available during server render)
    setNewRoomColorMode(loadColorMode());
  }, []);
  function chooseNewRoomColorMode(m: ColorMode) {
    setNewRoomColorMode(m);
    try { localStorage.setItem(COLOR_MODE_KEY, m); } catch {}
  }
  // The current room's mode and each person's color (clientId → color), sent by the server.
  const [colorMode, setColorMode] = useState<ColorMode>('free');
  const [personColors, setPersonColors] = useState<Record<string, string>>({});
  const [personNames, setPersonNames] = useState<Record<string, string>>({});

  // Page navigation
  const [currentPage, setCurrentPage] = useState(0);
  const [numPages, setNumPages] = useState(0);

  // Raise hand
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<string[]>([]);

  // Laser
  const [remoteLasers, setRemoteLasers] = useState<
    { socketId: string; x: number; y: number; page: number }[]
  >([]);

  // Toasts
  const [toasts, setToasts] = useState<{ id: string; msg: string; onClick?: () => void }[]>([]);

  const [metronomePanelOpen, setMetronomePanelOpen] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const chatOpenRef = useRef(false);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [tunerOpen, setTunerOpen] = useState(false);
  const [pitchLiveOpen, setPitchLiveOpen] = useState(false);
  const [pitchShareEnabled, setPitchShareEnabled] = useState(false);
  const [pitchA4Ref, setPitchA4Ref] = useState(440);
  const [pitchInstrument, setPitchInstrument] = useState<InstrumentKey>('violin');
  const [remotePitches, setRemotePitches] = useState<Record<string, RemotePitchEntry>>({});
  const remotePitchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [accountPanel, setAccountPanel] = useState<PanelTab | null>(null);
  const [theme, setThemeState] = useState<Theme>('auto');
  const [scoreName, setScoreName] = useState('Untitled Score');
  const [remoteMetronomeState, setRemoteMetronomeState] = useState<MetronomeState | null>(null);
  const [hiddenOwners, setHiddenOwners] = useState<Set<string>>(new Set());
  const [layersOpen, setLayersOpen] = useState(false);
  // ── OMR (measure detection) ──
  const [omrOpen, setOmrOpen] = useState(false);
  const [omrState, setOmrState] = useState<OmrState | null>(null);
  const [omrPrefs, setOmrPrefsState] = useState<OmrPrefs>(DEFAULT_OMR_PREFS);
  const [measureJump, setMeasureJump] = useState<{ page: number; y: number; n: number; nonce: number } | null>(null);
  const omrStateRef = useRef<OmrState | null>(null);
  omrStateRef.current = omrState;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OMR_PREFS_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load saved settings after mount (localStorage is not available during server render)
      if (raw) setOmrPrefsState({ ...DEFAULT_OMR_PREFS, ...JSON.parse(raw) });
    } catch {}
  }, []);
  function setOmrPrefs(p: OmrPrefs) {
    setOmrPrefsState(p);
    try { localStorage.setItem(OMR_PREFS_KEY, JSON.stringify(p)); } catch {}
  }
  const measuresByPage = useMemo(() => {
    if (omrState?.status !== 'done' || !omrState.pages) return null;
    const map: Record<number, OmrMeasure[]> = {};
    for (const p of omrState.pages) map[p.page] = p.measures;
    return map;
  }, [omrState]);
  // Scroll to bar n locally. Returns false if the bar is unknown.
  function jumpToMeasureLocal(n: number): boolean {
    for (const p of omrStateRef.current?.pages ?? []) {
      const m = p.measures.find(mm => mm.n === n);
      if (m) { setMeasureJump({ page: p.page, y: m.y, n, nonce: Date.now() }); return true; }
    }
    return false;
  }
  const [imslpSource, setImslpSource] = useState<{ pageUrl: string; fileUrl: string } | null>(null);

  // Nicknames
  const [nickname, setNickname] = useState('');
  const [nicknameMap, setNicknameMap] = useState<Record<string, string>>({});
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [nicknameModalDefault, setNicknameModalDefault] = useState('');
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);

  // Raise-hand panel
  const [showHandsPanel, setShowHandsPanel] = useState(false);
  const [handSoundMuted, setHandSoundMuted] = useState(() => {
    try { return localStorage.getItem('unino_hand_muted') === '1'; } catch { return false; }
  });

  // Single shared mic stream — active only when tuner or live pitch is open
  const { reading: pitchReading, error: pitchError } = usePitch(
    stage === 'room' && (tunerOpen || pitchLiveOpen),
    pitchInstrument,
    pitchA4Ref,
  );

  // Throttled pitch share: emit at most 20/sec when sharing is on
  const lastPitchEmitRef = useRef(0);
  useEffect(() => {
    if (!pitchShareEnabled || !pitchReading?.active || !roomId) return;
    const now = Date.now();
    if (now - lastPitchEmitRef.current < 50) return;
    lastPitchEmitRef.current = now;
    const senderName =
      (user?.user_metadata?.full_name as string | undefined)?.trim() ||
      user?.email?.split('@')[0] || 'Guest';
    socket.emit('pitch-update', {
      roomId,
      senderName,
      note: `${pitchReading.note}${pitchReading.octave}`,
      cents: pitchReading.cents,
      freq: pitchReading.freq,
      midi: pitchReading.midi,
      timestamp: now,
    });
  }, [pitchReading, pitchShareEnabled, roomId]);

  const roomIdRef = useRef<string | null>(null);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  const nicknameRef = useRef('');
  useEffect(() => { nicknameRef.current = nickname; }, [nickname]);
  const isHostRef = useRef(false);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  const handSoundMutedRef = useRef(handSoundMuted);
  useEffect(() => { handSoundMutedRef.current = handSoundMuted; }, [handSoundMuted]);
  const nicknameMapRef = useRef<Record<string, string>>({});
  useEffect(() => { nicknameMapRef.current = nicknameMap; }, [nicknameMap]);

  // Persist bookmarks to localStorage whenever they change
  useEffect(() => {
    if (!roomId) return;
    localStorage.setItem(`unino_bookmarks_${roomId}`, JSON.stringify(bookmarks));
  }, [bookmarks, roomId]);

  // Load saved layer visibility when entering a room
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset/load layer visibility when the room changes
    if (!roomId) { setHiddenOwners(new Set()); return; }
    try {
      const saved = localStorage.getItem(`unino_layers_${roomId}`);
      setHiddenOwners(saved ? new Set(JSON.parse(saved)) : new Set());
    } catch { setHiddenOwners(new Set()); }
  }, [roomId]);

  // Persist layer visibility whenever it changes
  useEffect(() => {
    if (!roomId) return;
    try { localStorage.setItem(`unino_layers_${roomId}`, JSON.stringify([...hiddenOwners])); } catch {}
  }, [hiddenOwners, roomId]);

  // Scroll sync & presence
  const [scrollSyncEnabled, setScrollSyncEnabled] = useState(false);
  // ── Follow the teacher (students) ──
  // On: the student's view follows the teacher's page, scroll (when the teacher shares it)
  // and bar jumps. Scrolling by hand while the teacher shares scroll pauses following.
  const [followTeacher, setFollowTeacher] = useState(true);
  const followRef = useRef(true);
  followRef.current = followTeacher;
  // Where the teacher is, kept up to date even while not following, so "Follow" can jump back.
  const teacherPosRef = useRef<{ page: number; scroll: number | null; bar: number | null }>({ page: 0, scroll: null, bar: null });
  const [remoteScrollPosition, setRemoteScrollPosition] = useState<number | null>(null);
  const [participantCount, setParticipantCount] = useState(0);

  // Toolbar position
  const [savedToolbarPos, setToolbarPosState] = useState<ToolbarPos>('top');
  // Phones and iPad portrait always use the top bar; side bars are too wide for them.
  const isPhone = usePhone();
  const isNarrow = useNarrow();
  const toolbarPos: ToolbarPos = isNarrow ? 'top' : savedToolbarPos;
  useEffect(() => {
    const saved = localStorage.getItem(POS_KEY) as ToolbarPos | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load saved settings after mount (localStorage is not available during server render)
    if (saved === 'top' || saved === 'left' || saved === 'right') setToolbarPosState(saved);
  }, []);

  // ── Theme ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('unino_theme') as Theme | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load saved settings after mount (localStorage is not available during server render)
    if (saved === 'auto' || saved === 'dark' || saved === 'light') setThemeState(saved);
  }, []);

  function applyThemeSetting(t: Theme) {
    const effective = t === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : t;
    document.documentElement.setAttribute('data-theme', effective);
  }

  useEffect(() => {
    applyThemeSetting(theme);
    localStorage.setItem('unino_theme', theme);
  }, [theme]);

  // Real-time system preference updates when in auto mode
  useEffect(() => {
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  function setTheme(t: Theme) { setThemeState(t); }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      if (session?.user) {
        fetchRecentSessions(session.user.id).then(setRecentSessions);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setShowAuthModal(false);
        fetchRecentSessions(session.user.id).then(setRecentSessions);
      } else {
        setRecentSessions([]);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function getInitial() {
    const name = user?.user_metadata?.full_name as string | undefined;
    if (name) return name[0].toUpperCase();
    if (user?.email) return user.email[0].toUpperCase();
    return '?';
  }

  async function handleSignOut() {
    setShowUserMenu(false);
    setAccountPanel(null);
    if (stage === 'room') goHome();
    await supabase.auth.signOut();
  }

  const owners = useMemo<LayerOwner[]>(() => {
    const seen = new Map<string, number>();
    for (const ann of annotations) {
      if (ann.ownerId && !seen.has(ann.ownerId)) seen.set(ann.ownerId, seen.size);
    }
    return Array.from(seen.entries()).map(([ownerId, idx]) => {
      const isMe = ownerId === myClientId;
      const label = nicknameMap[ownerId] || personNames[ownerId] || (isMe ? (nickname || 'You') : 'Guest');
      const color = (colorMode !== 'free' && personColors[ownerId]) || OWNER_COLORS[idx % OWNER_COLORS.length];
      return { ownerId, label, color, isMe };
    });
  }, [annotations, myClientId, nicknameMap, nickname, colorMode, personColors, personNames]);

  // With color by person, every mark is shown in its owner's color (so changing a color recolors their marks).
  const byPerson = colorMode !== 'free';
  const myPersonColor = byPerson ? personColors[myClientId] : undefined;
  const displayAnnotations = useMemo(() => {
    if (!byPerson) return annotations;
    return annotations.map(a => {
      const c = a.ownerId && personColors[a.ownerId];
      return c && a.color !== c ? { ...a, color: c } : a;
    });
  }, [annotations, byPerson, personColors]);
  // People who have a color in this room (everyone who joined, plus anyone who drew).
  const colorPeople = useMemo(() => Object.entries(personColors).map(([cid, c]) => ({
    clientId: cid,
    color: c,
    label: nicknameMap[cid] || personNames[cid] || (cid === myClientId ? (nickname || 'You') : 'Guest'),
    isMe: cid === myClientId,
  })), [personColors, personNames, nicknameMap, myClientId, nickname]);
  function setPersonColor(clientId: string, c: string) {
    if (!roomId) return;
    setPersonColors(prev => ({ ...prev, [clientId]: c })); // show at once; the server confirms
    socket.emit('set-person-color', { roomId, clientId, color: c });
  }
  function setRoomColorMode(m: ColorMode) {
    if (!roomId || !isHost) return;
    socket.emit('set-color-mode', { roomId, mode: m });
  }

  // ── Shared helpers ────────────────────────────────────────────────────────
  function changeToolbarPos(p: ToolbarPos) {
    setToolbarPosState(p);
    localStorage.setItem(POS_KEY, p);
  }

  function addToast(msg: string, onClick?: () => void) {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, msg, onClick }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }

  function playChime() {
    if (handSoundMutedRef.current) return;
    try {
      const ctx = new AudioContext();
      const t = ctx.currentTime;
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t + i * 0.14);
        gain.gain.linearRampToValueAtTime(0.15, t + i * 0.14 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.5);
        osc.start(t + i * 0.14);
        osc.stop(t + i * 0.14 + 0.5);
      });
      setTimeout(() => ctx.close().catch(() => {}), 1200);
    } catch {}
  }

  function maybeNotify(title: string, body: string) {
    try {
      if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') return;
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body, silent: true });
      }
    } catch {}
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync socket id if the socket connected before mount
    if (socket.connected) setMySocketId(socket.id!);
    socket.on('connect', () => {
      setMySocketId(socket.id!);
      if (roomIdRef.current && nicknameRef.current) {
        const rid = roomIdRef.current;
        let storedHostToken: string | null = null;
        try { storedHostToken = localStorage.getItem(`unino_host_${rid}`); } catch {}
        socket.emit('join-room', {
          roomId: rid,
          nickname: nicknameRef.current,
          clientId: myClientId,
          hostToken: storedHostToken,
        });
      }
    });

    const params = new URLSearchParams(window.location.search);
    const rid = params.get('room');
    if (rid) joinRoom(rid);

    socket.on('load-shapes', (existing: any[]) => {
      const seen = new Set<string>();
      setAnnotations(existing.filter(a => seen.has(a.id) ? false : seen.add(a.id) && true));
    });
    socket.on('new-shape', (shape: any) =>
      setAnnotations(prev => prev.some(a => a.id === shape.id) ? prev : [...prev, shape]));
    socket.on('clear', () => setAnnotations([]));
    socket.on('delete-shape', (id) => setAnnotations(prev => prev.filter(a => a.id !== id)));
    socket.on('update-shape', ({ id, changes }: { id: string; changes: any }) =>
      setAnnotations(prev => prev.map(a => a.id === id ? { ...a, ...changes } : a)));
    socket.on('undo', (id: string) => setAnnotations(prev => prev.filter(a => a.id !== id)));

    socket.on('room-info', ({ isHost: h, raisedHands: rh, currentPage: cp }: {
      isHost: boolean; raisedHands: string[]; currentPage: number;
    }) => {
      setIsHost(h);
      setRaisedHands(rh ?? []);
      setCurrentPage(cp ?? 0);
      teacherPosRef.current = { page: cp ?? 0, scroll: null, bar: null };
      setFollowTeacher(true);
    });

    socket.on('page-changed', (page: number) => {
      teacherPosRef.current = { ...teacherPosRef.current, page, bar: null };
      if (followRef.current) setCurrentPage(page);
    });

    socket.on('omr-state', (s: OmrState) => setOmrState(s));
    socket.on('measure-highlight', ({ n }: { n: number | null }) =>
      setOmrState(prev => prev ? { ...prev, highlightedMeasure: n } : prev));
    socket.on('measure-jump', ({ n }: { n: number }) => {
      teacherPosRef.current = { ...teacherPosRef.current, bar: n };
      if (followRef.current) jumpToMeasureLocal(n);
    });

    socket.on('laser-move', ({ socketId, x, y, page }: {
      socketId: string; x: number; y: number; page: number;
    }) => {
      setRemoteLasers(prev => [
        ...prev.filter(l => l.socketId !== socketId),
        { socketId, x, y, page },
      ]);
    });
    socket.on('laser-stop', ({ socketId }: { socketId: string }) => {
      setRemoteLasers(prev => prev.filter(l => l.socketId !== socketId));
    });

    socket.on('raise-hand', ({ socketId, nickname: raiserNick }: { socketId: string; nickname?: string }) => {
      setRaisedHands(prev => prev.includes(socketId) ? prev : [...prev, socketId]);
      if (socketId !== socket.id && isHostRef.current) {
        const displayName = raiserNick || nicknameMapRef.current[socketId] || 'Someone';
        addToast(tRef.current('✋ {name} raised a hand', { name: displayName }), () => setShowHandsPanel(true));
        playChime();
        maybeNotify(tRef.current('Hand raised'), tRef.current('{name} wants to speak', { name: displayName }));
      }
    });
    socket.on('lower-hand', ({ socketId }: { socketId: string }) => {
      setRaisedHands(prev => prev.filter(id => id !== socketId));
      // If the host dismissed our hand, sync local state.
      if (socketId === socket.id) setHandRaised(false);
    });

    socket.on('nickname-assigned', ({ nickname: n }: { nickname: string }) => {
      setNickname(n);
      nicknameRef.current = n;
      try { localStorage.setItem('unino_nickname', n); } catch {}
    });
    socket.on('nickname-map', (map: Record<string, string>) => {
      setNicknameMap(map);
      nicknameMapRef.current = map;
    });
    socket.on('member-joined', ({ socketId, clientId: cid, nickname: n }: { socketId: string; clientId?: string; nickname: string }) => {
      setNicknameMap(prev => {
        const next = { ...prev, [socketId]: n };
        if (cid) next[cid] = n;
        nicknameMapRef.current = next;
        return next;
      });
    });
    socket.on('member-left', ({ socketId }: { socketId: string }) => {
      // Keep the clientId entry — it's stable and needed for annotation ownership labels
      setNicknameMap(prev => { const next = { ...prev }; delete next[socketId]; nicknameMapRef.current = next; return next; });
    });
    socket.on('name-changed', ({ socketId, clientId: cid, nickname: n }: { socketId: string; clientId?: string; nickname: string }) => {
      setNicknameMap(prev => {
        const next = { ...prev, [socketId]: n };
        if (cid) next[cid] = n;
        nicknameMapRef.current = next;
        return next;
      });
    });
    socket.on('person-colors', ({ mode, colors, names }: { mode: ColorMode; colors: Record<string, string>; names?: Record<string, string> }) => {
      setColorMode(mode === 'assigned' || mode === 'self' ? mode : 'free');
      setPersonColors(colors || {});
      setPersonNames(names || {});
    });
    socket.on('host-claimed', ({ hostToken }: { hostToken: string }) => {
      if (roomIdRef.current) {
        try { localStorage.setItem(`unino_host_${roomIdRef.current}`, hostToken); } catch {}
      }
      setIsHost(true);
      addToast(tRef.current('You are now the host of this room'));
    });

    socket.on('scroll-sync', (ratio: number | null) => {
      teacherPosRef.current = { ...teacherPosRef.current, scroll: ratio, bar: null };
      if (followRef.current) setRemoteScrollPosition(ratio);
    });
    socket.on('room-members-count', (count: number) => setParticipantCount(count));
    socket.on('metronome-update', (state: MetronomeState) => setRemoteMetronomeState(state));

    socket.on('chat-history', (history: ChatMessage[]) => {
      setChatMessages(history);
      setChatUnread(0);
    });
    socket.on('chat-message', (msg: ChatMessage) => {
      // Skip own messages — they're shown optimistically in handleSendChat
      if (msg.senderId === socket.id) return;
      setChatMessages(prev => [...prev, msg]);
      if (!chatOpenRef.current) {
        setChatUnread(prev => prev + 1);
      }
    });

    socket.on('bookmark-add', ({ page }: { page: number }) => {
      setBookmarks(prev => prev.includes(page) ? prev : [...prev, page].sort((a, b) => a - b));
    });
    socket.on('bookmark-remove', ({ page }: { page: number }) => {
      setBookmarks(prev => prev.filter(p => p !== page));
    });

    socket.on('pitch-update', (entry: RemotePitchEntry) => {
      setRemotePitches(prev => ({ ...prev, [entry.senderId]: { ...entry, updatedAt: Date.now() } }));
      // Auto-expire sender after 3s of silence
      clearTimeout(remotePitchTimers.current[entry.senderId]);
      remotePitchTimers.current[entry.senderId] = setTimeout(() => {
        setRemotePitches(prev => {
          const next = { ...prev };
          delete next[entry.senderId];
          return next;
        });
      }, 3000);
    });

    return () => {
      socket.off('connect');
      socket.off('load-shapes'); socket.off('new-shape'); socket.off('clear');
      socket.off('delete-shape'); socket.off('update-shape'); socket.off('undo');
      socket.off('room-info'); socket.off('page-changed');
      socket.off('laser-move'); socket.off('laser-stop');
      socket.off('raise-hand'); socket.off('lower-hand');
      socket.off('nickname-assigned'); socket.off('nickname-map');
      socket.off('member-joined'); socket.off('member-left'); socket.off('name-changed');
      socket.off('host-claimed'); socket.off('person-colors');
      socket.off('scroll-sync'); socket.off('room-members-count');
      socket.off('metronome-update');
      socket.off('chat-history'); socket.off('chat-message');
      socket.off('bookmark-add'); socket.off('bookmark-remove');
      socket.off('pitch-update');
      socket.off('omr-state'); socket.off('measure-highlight'); socket.off('measure-jump');
    };
  }, []);

  function getNicknameDefault() {
    try { const s = localStorage.getItem('unino_nickname'); if (s) return s; } catch {}
    const firstName = ((user?.user_metadata?.full_name as string) || '').split(' ')[0] || '';
    return firstName || user?.email?.split('@')[0] || '';
  }

  async function joinRoom(rid: string) {
    const match = rid.match(/room=([a-f0-9-]{36})/);
    const cleanId = match ? match[1] : rid.trim();
    setLoading(true);
    try {
      const res = await fetch(backendUrl(`/room/${cleanId}`));
      if (!res.ok) { alert(t('Room not found. Check the link or code.')); setLoading(false); return; }
      const data = await res.json();
      const sn = data.scoreName || 'Untitled Score';
      setScoreName(sn);
      setPdfUrl(resolvePdfUrl(data.pdfUrl));
      setCurrentPage(data.currentPage ?? 0);
      setImslpSource(data.imslpSource ?? null);
      setRoomId(cleanId);
      roomIdRef.current = cleanId;
      const savedBM = localStorage.getItem(`unino_bookmarks_${cleanId}`);
      setBookmarks(savedBM ? JSON.parse(savedBM) : []);
      setStage('room');
      window.history.pushState({}, '', `?room=${cleanId}`);
      setPendingRoomId(cleanId);
      setNicknameModalDefault(getNicknameDefault());
      setShowNicknameModal(true);
    } catch { alert(t('Could not connect to the server.')); }
    setLoading(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    // Same limit as the server (200 MB); checked here too so big files fail instantly.
    if (file.size > 200 * 1024 * 1024) {
      setUploadError('This PDF is larger than 200 MB. Try a smaller file.');
      e.target.value = '';
      return;
    }
    setLoading(true);
    const formData = new FormData();
    formData.append('pdf', file);
    let url = '';
    let uploadedName: string | undefined;
    try {
      const uploadRes = await fetch(backendUrl('/upload'), { method: 'POST', body: formData });
      const body = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !body.url) throw new Error(body.error || 'Upload failed. Try again.');
      url = body.url;
      uploadedName = body.scoreName;
    } catch (err) {
      // Never create a room without a PDF.
      setUploadError(err instanceof Error && err.message !== 'Failed to fetch' ? err.message : 'Could not reach the server. Is the backend running?');
      setLoading(false);
      e.target.value = '';
      return;
    }
    const sn = uploadedName || file.name.replace(/\.pdf$/i, '').trim() || 'Untitled Score';
    setScoreName(sn);
    let supabaseToken: string | null = null;
    if (user) {
      try { const { data } = await supabase.auth.getSession(); supabaseToken = data.session?.access_token ?? null; } catch {}
    }
    const res = await fetch(backendUrl('/create-room'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfUrl: url, scoreName: sn, creatorId: user?.id ?? null, clientId: myClientId, supabaseToken, colorMode: newRoomColorMode }),
    });
    const { roomId: rid, hostToken } = await res.json();
    try { localStorage.setItem(`unino_host_${rid}`, hostToken); } catch {};
    setPdfUrl(resolvePdfUrl(url));
    setCurrentPage(0);
    setRoomId(rid);
    roomIdRef.current = rid;
    setBookmarks([]);
    setIsHost(true);
    setStage('room');
    window.history.pushState({}, '', `?room=${rid}`);
    setPendingRoomId(rid);
    setNicknameModalDefault(getNicknameDefault());
    setShowNicknameModal(true);
    setLoading(false);
  }

  function handleIMSLPImport(data: { roomId: string; hostToken: string; pdfUrl: string; scoreName: string; imslpPageUrl?: string }) {
    try { localStorage.setItem(`unino_host_${data.roomId}`, data.hostToken); } catch {}
    setScoreName(data.scoreName);
    setPdfUrl(resolvePdfUrl(data.pdfUrl));
    setCurrentPage(0);
    setRoomId(data.roomId);
    roomIdRef.current = data.roomId;
    setBookmarks([]);
    setIsHost(true);
    setStage('room');
    if (data.imslpPageUrl) setImslpSource({ pageUrl: data.imslpPageUrl, fileUrl: data.imslpPageUrl });
    window.history.pushState({}, '', `?room=${data.roomId}`);
    setPendingRoomId(data.roomId);
    setNicknameModalDefault(getNicknameDefault());
    setShowNicknameModal(true);
  }

  async function confirmNickname(name: string) {
    const trimmed = name.trim().slice(0, 20);
    setShowNicknameModal(false);
    if (pendingRoomId) {
      const rid = pendingRoomId;
      setPendingRoomId(null);
      setNicknameMap({});
      nicknameMapRef.current = {};

      let storedHostToken: string | null = null;
      try { storedHostToken = localStorage.getItem(`unino_host_${rid}`); } catch {}

      let supabaseToken: string | null = null;
      if (user) {
        try { const { data } = await supabase.auth.getSession(); supabaseToken = data.session?.access_token ?? null; } catch {}
      }

      socket.emit('join-room', { roomId: rid, nickname: trimmed, clientId: myClientId, hostToken: storedHostToken, supabaseToken });
      if (user) {
        upsertSession(user.id, rid, scoreName).then(() =>
          fetchRecentSessions(user.id).then(setRecentSessions),
        );
      }
    } else if (roomId) {
      socket.emit('rename', { roomId, nickname: trimmed });
    }
  }

  function handleRename() {
    setNicknameModalDefault(nickname);
    setShowNicknameModal(true);
  }

  function handleToggleChat() {
    setChatOpen(prev => {
      if (!prev) setChatUnread(0); // clear badge when opening
      return !prev;
    });
  }

  function handleToggleThumbs() {
    setThumbsOpen(prev => !prev);
  }

  function handleToggleBookmark() {
    if (!roomId) return;
    const page = currentPage;
    const isBookmarked = bookmarks.includes(page);
    if (isBookmarked) {
      setBookmarks(prev => prev.filter(p => p !== page));
      socket.emit('bookmark-remove', { roomId, page });
    } else {
      setBookmarks(prev => [...prev, page].sort((a, b) => a - b));
      socket.emit('bookmark-add', { roomId, page });
    }
  }

  function handleSendChat(text: string) {
    if (!roomId) return;
    const senderName = nickname || (user?.user_metadata?.full_name as string | undefined)?.trim() || user?.email?.split('@')[0] || 'Guest';
    // Optimistic: show own message immediately without waiting for server echo
    const optimisticMsg: ChatMessage = {
      id: `local-${Date.now()}-${Math.random()}`,
      senderId: socket.id ?? '',
      senderName,
      text,
      timestamp: new Date().toISOString(),
      isHost,
    };
    setChatMessages(prev => [...prev, optimisticMsg]);
    socket.emit('chat-message', { roomId, text, senderName });
  }

  function goHome() {
    if (roomId) socket.emit('leave-room', roomId);
    setStage('home');
    setRoomId(null);
    setPdfUrl(null);
    setAnnotations([]);
    setUndoStack([]);
    setRedoStack([]);
    setIsHost(false);
    setHandRaised(false);
    setRaisedHands([]);
    setRemoteLasers([]);
    setCurrentPage(0);
    setNumPages(0);
    setScrollSyncEnabled(false);
    setRemoteScrollPosition(null);
    setParticipantCount(0);
    setScoreName('Untitled Score');
    setChatOpen(false);
    setChatMessages([]);
    setChatUnread(0);
    setThumbsOpen(false);
    setBookmarks([]);
    setLayersOpen(false);
    setHiddenOwners(new Set());
    setColorMode('free');
    setPersonColors({});
    setPersonNames({});
    setImslpSource(null);
    setShowHandsPanel(false);
    setNicknameMap({});
    nicknameMapRef.current = {};
    setPendingRoomId(null);
    setShowNicknameModal(false);
    setTunerOpen(false);
    setPitchLiveOpen(false);
    setPitchShareEnabled(false);
    setRemotePitches({});
    Object.values(remotePitchTimers.current).forEach(clearTimeout);
    remotePitchTimers.current = {};
    window.history.pushState({}, '', '/');
  }

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/?room=${roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Undo / redo ─────────────────────────────────────────────────────────
  function recordHistory(op: HistoryOp) {
    if (historyBatchRef.current) { historyBatchRef.current.push(op); return; }
    setUndoStack(prev => [...prev, [op]]);
    setRedoStack([]);
  }
  function beginHistoryBatch() { historyBatchRef.current = []; }

  // Cmd/Ctrl+Z = undo, Shift+Cmd/Ctrl+Z or Ctrl+Y = redo (not while typing in a field).
  const undoRedoRef = useRef({ undo: () => {}, redo: () => {} });
  undoRedoRef.current = { undo, redo };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRedoRef.current.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); undoRedoRef.current.redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  function endHistoryBatch() {
    const ops = historyBatchRef.current;
    historyBatchRef.current = null;
    if (ops && ops.length) {
      setUndoStack(prev => [...prev, ops]);
      setRedoStack([]);
    }
  }

  // Apply one change locally and on the server (used by undo and redo).
  function applyAdd(ann: any) {
    knownAnnotationsRef.current.set(ann.id, ann);
    setAnnotations(prev => prev.some(a => a.id === ann.id) ? prev : [...prev, ann]);
    socket.emit('new-shape', { roomId, shape: ann });
  }
  function applyDelete(id: string) {
    setAnnotations(prev => prev.filter(a => a.id !== id));
    socket.emit('delete-shape', { roomId, id });
  }
  function applyGeometry(id: string, changes: any) {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, ...changes } : a));
    socket.emit('update-shape', { roomId, id, changes });
  }

  function undo() {
    const group = undoStack[undoStack.length - 1];
    if (!group) return;
    setUndoStack(prev => prev.slice(0, -1));
    // Reverse each change, last first.
    for (const op of [...group].reverse()) {
      if (op.kind === 'add') applyDelete(op.ann.id);
      else if (op.kind === 'delete') applyAdd(op.ann);
      else applyGeometry(op.id, op.before);
    }
    setRedoStack(prev => [...prev, group]);
  }

  function redo() {
    const group = redoStack[redoStack.length - 1];
    if (!group) return;
    setRedoStack(prev => prev.slice(0, -1));
    for (const op of group) {
      if (op.kind === 'add') applyAdd(op.ann);
      else if (op.kind === 'delete') applyDelete(op.ann.id);
      else applyGeometry(op.id, op.after);
    }
    setUndoStack(prev => [...prev, group]);
  }

  function handleAnnotationAdd(annotation: any) {
    const { _skipUndo, ...rest } = annotation;
    const withOwner = { ...rest, ownerId: rest.ownerId ?? myClientId };
    knownAnnotationsRef.current.set(withOwner.id, withOwner);
    setAnnotations(prev => prev.some(a => a.id === withOwner.id) ? prev : [...prev, withOwner]);
    // Pieces created by the eraser are recorded as part of the swipe's undo group.
    if (!_skipUndo || historyBatchRef.current) recordHistory({ kind: 'add', ann: withOwner });
    socket.emit('new-shape', { roomId, shape: withOwner });
    // If I drew while my layer is hidden, automatically un-hide it.
    if (hiddenOwners.has(myClientId)) {
      setHiddenOwners(prev => { const n = new Set(prev); n.delete(myClientId); return n; });
    }
  }

  function extractGeometry(a: any) {
    if (a.type === 'pen')       return { points: a.points };
    if (a.type === 'highlight' || a.type === 'symbol') return { x: a.x, y: a.y, w: a.w, h: a.h };
    if (a.type === 'ellipse')   return { cx: a.cx, cy: a.cy, rx: a.rx, ry: a.ry };
    if (a.type === 'line')      return { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 };
    if (a.type === 'text')      return { x: a.x, y: a.y, fontSize: a.fontSize };
    return {};
  }

  function handleAnnotationUpdate(id: string, changes: any, final: boolean, prevAnnotation?: any) {
    socket.emit('update-shape', { roomId, id, changes });
    if (final) {
      setAnnotations(prev => prev.map(a => a.id === id ? { ...a, ...changes } : a));
      if (prevAnnotation) {
        recordHistory({ kind: 'update', id, before: extractGeometry(prevAnnotation), after: changes });
      }
    }
  }

  function handleAnnotationDelete(id: string) {
    // Prefer rendered state (current geometry); fall back to pieces added moments ago.
    const ann = annotations.find(a => a.id === id) ?? knownAnnotationsRef.current.get(id);
    if (ann && (isHost || ann.ownerId === myClientId)) recordHistory({ kind: 'delete', ann });
    setAnnotations(prev => prev.filter(a => a.id !== id));
    socket.emit('delete-shape', { roomId, id });
  }

  function clearAll() {
    // Only the host can wipe everything; students clear just their own marks (server enforces this too).
    if (hiddenOwners.size === 0 && isHost) {
      setAnnotations([]);
      setUndoStack([]);
      setRedoStack([]);
      socket.emit('clear', roomId);
    } else {
      // Only clear visible (non-hidden) annotations that this user has permission to delete.
      const toDelete = annotations.filter(a => !hiddenOwners.has(a.ownerId) && (isHost || a.ownerId === myClientId));
      toDelete.forEach(a => socket.emit('delete-shape', { roomId, id: a.id }));
      setAnnotations(prev => prev.filter(a => hiddenOwners.has(a.ownerId) || (!isHost && a.ownerId !== myClientId)));
      setUndoStack([]);
      setRedoStack([]);
    }
  }

  function toggleScrollSync() {
    const next = !scrollSyncEnabled;
    setScrollSyncEnabled(next);
    if (!next) socket.emit('scroll-sync', { roomId, ratio: null });
  }

  function toggleHand() {
    const next = !handRaised;
    setHandRaised(next);
    socket.emit(next ? 'raise-hand' : 'lower-hand', roomId);
  }

  function handleLaserMove(x: number, y: number, page: number) {
    socket.emit('laser-move', { roomId, x, y, page });
  }

  function handleLaserStop() {
    socket.emit('laser-stop', roomId);
  }

  function handleScrollPositionChange(ratio: number) {
    socket.emit('scroll-sync', { roomId, ratio });
  }

  // A student moving around on their own stops following, but only when it would otherwise
  // be overridden: hand-scrolling only matters while the teacher shares scroll position.
  function pauseFollowing(reason: 'scroll' | 'page') {
    if (isHost || !followRef.current) return;
    if (reason === 'scroll' && teacherPosRef.current.scroll === null) return;
    followRef.current = false;
    setFollowTeacher(false);
  }

  // Follow again and jump straight to where the teacher is.
  function resumeFollowing() {
    followRef.current = true;
    setFollowTeacher(true);
    const pos = teacherPosRef.current;
    if (pos.bar != null && jumpToMeasureLocal(pos.bar)) return;
    setCurrentPage(pos.page);
    if (pos.scroll !== null) {
      // Re-send the ratio even if unchanged, after the page scroll has started.
      setRemoteScrollPosition(null);
      setTimeout(() => setRemoteScrollPosition(pos.scroll), 450);
    }
  }

  function handlePageChange(page: number, fromScroll = false) {
    if (!fromScroll) pauseFollowing('page');
    if (page < 0 || page >= numPages || page === currentPage) return;
    setCurrentPage(page);
    if (isHost && (!fromScroll || scrollSyncEnabled)) {
      socket.emit('change-page', { roomId, page });
    }
  }

  function setHighlightedMeasure(n: number | null) {
    setOmrState(prev => prev ? { ...prev, highlightedMeasure: n } : prev);
    socket.emit('measure-highlight', { roomId, n });
  }

  function handleMeasureClick(n: number) {
    setHighlightedMeasure(omrState?.highlightedMeasure === n ? null : n);
  }

  function handleMeasureJump(n: number): boolean {
    if (!jumpToMeasureLocal(n)) return false;
    if (isHost) socket.emit('measure-jump', { roomId, n });
    return true;
  }

  function handleMetronomeUpdate(state: MetronomeState) {
    socket.emit('metronome-update', { roomId, state });
  }

  async function handleExportPDF() {
    if (!pdfUrl) return;
    // Always show the modal so user can opt into "only visible layers" when layers are hidden.
    if (hiddenOwners.size > 0) {
      setShowExportModal(true);
      return;
    }
    if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
      const suggested = buildSuggestedFilename(pdfUrl, scoreName) + '.pdf';
      try {
        await exportAnnotatedPDF(pdfUrl, displayAnnotations, suggested);
      } catch (err: any) {
        if (err?.name !== 'AbortError') addToast(t('Export failed'));
      }
    } else {
      setShowExportModal(true);
    }
  }

  async function handleExportConfirm(filename: string, onlyVisible: boolean) {
    setShowExportModal(false);
    if (!pdfUrl) return;
    const annsToExport = onlyVisible
      ? displayAnnotations.filter(a => !hiddenOwners.has(a.ownerId))
      : displayAnnotations;
    try {
      await exportAnnotatedPDF(pdfUrl, annsToExport, filename);
      addToast(t('Saved to Downloads folder'));
    } catch {
      addToast(t('Export failed'));
    }
  }

  // ── HOME ──────────────────────────────────────────────────────────────────
  if (stage === 'home') {
    const displayName =
      ((user?.user_metadata?.full_name as string) ?? '').split(' ')[0] ||
      user?.email?.split('@')[0];

    return (
      <div className="unino-page min-h-screen flex" style={{ backgroundColor: 'var(--app-bg)', color: 'var(--t)' }}>
        {user && (
          <Sidebar
            open={sidebarOpen}
            onToggle={() => setSidebarOpen(o => !o)}
            sessions={recentSessions}
            onOpenRoom={joinRoom}
            onShowAllSessions={() => setAccountPanel('sessions')}
          />
        )}

        <div className="relative flex-1 flex flex-col overflow-hidden">
          {/* ambient glow */}
          <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full blur-[100px] pointer-events-none unino-glow" />

          {/* ── Header ── */}
          <header className="relative z-20 px-10 py-6 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div style={{ width: 28, height: 28, borderRadius: 'var(--r-sm)', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="16" r="3"/>
                </svg>
              </div>
              <span className="text-lg font-bold tracking-tight">Unino</span>
            </div>

            <div className="flex items-center gap-2">
            {!authLoading && (
              user ? (
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setShowUserMenu(o => !o)}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white select-none unino-avatar-btn"
                  >
                    {getInitial()}
                  </button>

                  {showUserMenu && (
                    <div className="unino-modal absolute right-0 top-11 py-1.5 w-48 z-50"
                      style={{ backgroundColor: 'var(--modal-bg)', border: '1px solid var(--border-md)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)' }}>
                      <div className="px-4 py-2.5 mb-1" style={{ borderBottom: '1px solid var(--divider)' }}>
                        <p className="text-sm font-medium text-white truncate">
                          {(user.user_metadata?.full_name as string) || user.email}
                        </p>
                        {user.user_metadata?.full_name && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{user.email}</p>
                        )}
                      </div>
                      {([
                        { label: 'Profile',     tab: 'profile'  },
                        { label: 'My Sessions', tab: 'sessions' },
                        { label: 'Settings',    tab: 'settings' },
                      ] as { label: string; tab: PanelTab }[]).map(({ label, tab }) => (
                        <button key={label}
                          onClick={() => { setShowUserMenu(false); setAccountPanel(tab); }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                          {t(label)}
                        </button>
                      ))}
                      <div className="mt-1 pt-1" style={{ borderTop: '1px solid var(--divider)' }}>
                        <button
                          onClick={handleSignOut}
                          className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors"
                        >
                          {t('Log out')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                <GuestSettings />
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-4 py-2 text-sm font-semibold unino-signin-btn"
                >
                  {t('Sign in')}
                </button>
                </>
              )
            )}
            </div>
          </header>

          {/* ── Main content ── */}
          <main className="relative z-10 flex flex-col items-center justify-center px-6 pt-8 pb-32 text-center flex-1">
            {/* Hero — logged out only */}
            {!user && (
              <>
                <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm mb-8"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--t2)' }}>
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  {t('Real-time sheet music collaboration')}
                </div>
                <h1 className="text-6xl font-bold mb-6 leading-tight">
                  <span className="unino-hero-gradient bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent">
                    {t('Annotate music.')}<br />{t('Together.')}
                  </span>
                </h1>
                <p className="text-gray-400 text-xl mb-16 max-w-lg">
                  {t('Upload your score, share a link, and annotate in real time — with anyone.')}
                </p>
              </>
            )}

            {/* Welcome — logged in only */}
            {user && (
              <div className="mb-10 text-left w-full max-w-2xl">
                <h2 className="text-3xl font-bold mb-1.5">
                  {displayName ? t('Welcome back, {name}', { name: displayName }) : t('Welcome back')}
                </h2>
                <p className="text-sm" style={{ color: 'var(--t2)' }}>{t('Ready to collaborate?')}</p>
              </div>
            )}

            {/* Recent sessions — logged-in only */}
            {user && (
              <div className="w-full max-w-2xl mb-10 text-left">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">{t('Recent')}</h3>
                  {recentSessions.length > 5 && (
                    <button
                      onClick={() => setShowAllSessions(s => !s)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      {showAllSessions ? t('Show less') : t('See all {n} →', { n: recentSessions.length })}
                    </button>
                  )}
                </div>

                {recentSessions.length === 0 ? (
                  <div className="flex items-center gap-3 px-5 py-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                      className="w-5 h-5 shrink-0" style={{ color: 'var(--t3)' }}>
                      <path d="M9 18V5l12-2v13"/>
                      <circle cx="6" cy="18" r="3"/>
                      <circle cx="18" cy="16" r="3"/>
                    </svg>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--t2)' }}>{t('No recent sessions yet')}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>{t('Upload a score below to start your first session.')}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {(showAllSessions ? recentSessions : recentSessions.slice(0, 5)).map(s => (
                      <button
                        key={s.id}
                        onClick={() => joinRoom(s.room_id)}
                        className="flex items-center gap-4 px-5 py-3.5 text-left group unino-session-row"
                        style={{ borderRadius: 'var(--r-lg)' }}
                      >
                        <div className="w-9 h-9 flex items-center justify-center flex-shrink-0"
                          style={{ borderRadius: 'var(--r-sm)', background: 'var(--accent-bg)', border: '1px solid rgba(94,92,230,0.2)' }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                            className="w-4 h-4" style={{ color: 'var(--accent-fg)' }}>
                            <path d="M9 18V5l12-2v13"/>
                            <circle cx="6" cy="18" r="3"/>
                            <circle cx="18" cy="16" r="3"/>
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate u-text">{s.score_name}</p>
                          <p className="text-xs text-gray-600 mt-0.5">{relativeTime(s.last_accessed, t)}</p>
                        </div>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
                          strokeLinecap="round" strokeLinejoin="round"
                          className="w-4 h-4 text-gray-700 group-hover:text-gray-400 transition-colors flex-shrink-0">
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Action cards — always shown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-2xl" style={{ maxWidth: 672 }}>
              <div className="p-8 flex flex-col items-start gap-5 text-left"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)' }}>
                <div className="w-14 h-14 flex items-center justify-center"
                  style={{ borderRadius: 'var(--r-lg)', background: 'var(--accent-bg)', border: '1px solid rgba(94,92,230,0.2)' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                    className="w-6 h-6" style={{ color: 'var(--accent-fg)' }}>
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/>
                    <circle cx="18" cy="16" r="3"/>
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold mb-2 u-text">{t('Start a session')}</h2>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>{t('Upload a PDF score and create a room. Share the link with anyone to collaborate.')}</p>
                </div>
                <ColorModePicker value={newRoomColorMode} onChange={chooseNewRoomColorMode} />
                <label className={`w-full py-3 text-sm font-semibold text-center cursor-pointer transition-colors ${loading ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                  style={{ borderRadius: 'var(--r-md)' }}>
                  {loading ? t('Uploading…') : t('+ Upload Score')}
                  <input type="file" accept=".pdf" onChange={handleUpload} className="hidden" disabled={loading} />
                </label>
                {uploadError && (
                  <p role="alert" className="text-sm" style={{ color: '#ef4444', marginTop: -8 }}>{t(uploadError)}</p>
                )}
              </div>

              <div className="p-8 flex flex-col items-start gap-5 text-left"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)' }}>
                <div className="w-14 h-14 flex items-center justify-center"
                  style={{ borderRadius: 'var(--r-lg)', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                    className="w-6 h-6" style={{ color: 'rgb(16,185,129)' }}>
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold mb-2 u-text">{t('Join a session')}</h2>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>{t('Paste the link or room code you received to join a live session.')}</p>
                </div>
                <div className="w-full flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder={t('Paste link or room code…')}
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && joinCode && joinRoom(joinCode)}
                    className="w-full px-4 py-2.5 text-sm focus:outline-none u-input"
                  />
                  <button
                    onClick={() => joinCode && joinRoom(joinCode)}
                    disabled={loading || !joinCode}
                    className="w-full py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40"
                    style={{ borderRadius: 'var(--r-md)' }}
                  >
                    {loading ? t('Joining…') : t('Join Session →')}
                  </button>
                </div>
              </div>
            </div>
            {/* IMSLP section — below the main cards */}
            <div style={{ marginTop: 12, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: '100%', maxWidth: 672 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                    {t('or search / import from IMSLP')}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
                </div>
                <IMSLPPanel
                  clientId={myClientId}
                  colorMode={newRoomColorMode}
                  user={user}
                  onImportSuccess={handleIMSLPImport}
                />
              </div>
            </div>
          </main>

          {!user && (
            <footer className="relative z-10 text-center text-sm pb-8" style={{ color: 'var(--t3)' }}>
              {t('Built for musicians')}
              <div className="text-xs mt-1" style={{ color: 'var(--t3)', opacity: 0.6 }}>
                {t('Musical notation glyphs:')} <a href="/licenses/Bravura-LICENSE.txt" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline' }}>Bravura</a> &amp; <a href="/licenses/STIXTwo-LICENSE.txt" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline' }}>STIX Two</a> (SIL OFL 1.1)
              </div>
            </footer>
          )}
        </div>

        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

        {accountPanel && user && (
          <AccountPanel
            user={user}
            sessions={recentSessions}
            initialTab={accountPanel}
            theme={theme}
            onClose={() => setAccountPanel(null)}
            onOpenRoom={joinRoom}
            onSessionsChange={setRecentSessions}
            onThemeChange={setTheme}
            onUserUpdated={updated => setUser(updated)}
            onSignOut={handleSignOut}
          />
        )}
      </div>
    );
  }

  // ── ROOM ──────────────────────────────────────────────────────────────────

  const isHighlighter = activeTool === 'highlight';
  // Symbol em size (one staff height, as a fraction of page height): measured staff height
  // from measure detection when available, otherwise a default; scaled by S/M/L.
  function symbolEmForPage(page: number): number {
    const staff = omrState?.pages?.find(p => p.page === page)?.staffHeight;
    const base = typeof staff === 'number' && staff > 0.005 && staff < 0.2 ? staff : DEFAULT_SYMBOL_EM;
    return base * SYMBOL_SIZE_FACTOR[symbolSize];
  }
  function exitSymbolTool() { setActiveTool('select'); }
  const toolbarProps = {
    pos: toolbarPos,
    compact: isNarrow,
    personColor: myPersonColor,
    canPickPersonColor: colorMode === 'self' || isHost,
    onPickPersonColor: (c: string) => setPersonColor(myClientId, c),
    onPosChange: changeToolbarPos,
    activeTool,
    setActiveTool,
    eraserMode,
    setEraserMode,
    // Color/width controls edit the highlighter's own settings while it is the active tool.
    color: isHighlighter ? hl.color : color,
    setColor: (c: string) => (isHighlighter ? updateHl({ color: c }) : setColor(c)),
    strokeWidth: isHighlighter ? hl.width : strokeWidth,
    setStrokeWidth: (w: number) => (isHighlighter ? updateHl({ width: w }) : setStrokeWidth(w)),
    highlighterOpacity: hl.opacity,
    setHighlighterOpacity: (o: number) => updateHl({ opacity: o }),
    activeSymbol,
    onPickSymbol: pickSymbol,
    recentSymbols,
    symbolSize,
    setSymbolSize,
    isHost,
    participantCount,
    scrollSyncEnabled,
    handRaised,
    raisedHands,
    copied,
    metronomePanelOpen,
    currentPage,
    numPages,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    onRedo: redo,
    onGoHome: goHome,
    onUndo: undo,
    onClearAll: clearAll,
    onToggleScrollSync: toggleScrollSync,
    onToggleHand: toggleHand,
    onCopyLink: copyLink,
    onPageChange: handlePageChange,
    onToggleMetronome: () => setMetronomePanelOpen(o => !o),
    onExportPDF: handleExportPDF,
    chatOpen,
    chatUnread,
    onToggleChat: handleToggleChat,
    thumbsOpen,
    onToggleThumbs: handleToggleThumbs,
    bookmarkActive: bookmarks.includes(currentPage),
    onToggleBookmark: handleToggleBookmark,
    nickname,
    onRename: handleRename,
    onOpenHandsPanel: () => setShowHandsPanel(true),
  };

  return (
    <div
      className="flex overflow-hidden"
      style={{ height: '100dvh', background: 'var(--app-bg)', color: 'var(--t)', flexDirection: toolbarPos === 'top' ? 'column' : 'row' }}
    >
      {toolbarPos !== 'right' && <Toolbar key={toolbarPos} {...toolbarProps} />}

      {/* Thumbnail panel (left) + PDF + Chat panel (right) */}
      <div style={{ flex: '1 1 0', overflow: 'hidden', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
        {thumbsOpen && pdfUrl && (
          <ThumbnailPanel
            pdfUrl={pdfUrl}
            currentPage={currentPage}
            bookmarks={bookmarks}
            onPageClick={handlePageChange}
            onClose={handleToggleThumbs}
          />
        )}
        <div style={{ flex: '1 1 0', overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
          {pdfUrl && (
            <PDFViewer
              pdfUrl={pdfUrl}
              annotations={displayAnnotations}
              activeTool={activeTool}
              eraserMode={eraserMode}
              color={myPersonColor ?? (isHighlighter ? hl.color : color)}
              strokeWidth={isHighlighter ? hl.width : strokeWidth}
              highlighterOpacity={hl.opacity}
              isHost={isHost}
              mySocketId={mySocketId}
              myClientId={myClientId}
              remoteLasers={remoteLasers}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              onNumPagesLoaded={setNumPages}
              onAnnotationAdd={handleAnnotationAdd}
              onAnnotationDelete={handleAnnotationDelete}
              onAnnotationUpdate={handleAnnotationUpdate}
              hiddenOwners={hiddenOwners}
              onLaserMove={handleLaserMove}
              onLaserStop={handleLaserStop}
              scrollSyncEnabled={scrollSyncEnabled}
              remoteScrollPosition={remoteScrollPosition}
              onScrollPositionChange={handleScrollPositionChange}
              measuresByPage={measuresByPage}
              showMeasureNumbers={omrPrefs.showNumbers}
              highlightedMeasure={omrPrefs.showHighlight ? (omrState?.highlightedMeasure ?? null) : null}
              measureClickMode={omrPrefs.clickToHighlight && !!measuresByPage}
              onMeasureClick={handleMeasureClick}
              measureJump={measureJump}
              activeSymbol={activeSymbol}
              symbolEmForPage={symbolEmForPage}
              onSymbolPlaced={rememberSymbol}
              onSymbolMenu={setSymbolMenu}
              onExitSymbolTool={exitSymbolTool}
              onUserScroll={() => pauseFollowing('scroll')}
              onEraseStart={beginHistoryBatch}
              onEraseEnd={endHistoryBatch}
            />
          )}
        </div>
        {chatOpen && (
          <ChatPanel
            messages={chatMessages}
            mySocketId={mySocketId}
            onSend={handleSendChat}
            onClose={handleToggleChat}
          />
        )}
      </div>

      {toolbarPos === 'right' && <Toolbar key={toolbarPos} {...toolbarProps} />}

      {/* Floating action cluster */}
      <FloatingCluster
        thumbsOpen={thumbsOpen}
        onToggleThumbs={handleToggleThumbs}
        chatOpen={chatOpen}
        chatUnread={chatUnread}
        onToggleChat={handleToggleChat}
        metronomePanelOpen={metronomePanelOpen}
        onToggleMetronome={() => setMetronomePanelOpen(o => !o)}
        bookmarkActive={bookmarks.includes(currentPage)}
        onToggleBookmark={handleToggleBookmark}
        tunerOpen={tunerOpen}
        onToggleTuner={() => setTunerOpen(o => !o)}
        pitchLiveOpen={pitchLiveOpen}
        onTogglePitchLive={() => setPitchLiveOpen(o => !o)}
        layersOpen={layersOpen}
        hasHiddenLayers={hiddenOwners.size > 0}
        onToggleLayers={() => setLayersOpen(o => !o)}
        omrOpen={omrOpen}
        omrRunning={omrState?.status === 'running'}
        onToggleOmr={() => setOmrOpen(o => !o)}
        onExportPDF={handleExportPDF}
        compact={isPhone}
        rightOffset={
          chatOpen ? 314
          : toolbarPos === 'right' ? 206
          : 14
        }
      />

      {/* IMSLP source credit */}
      {imslpSource && (
        <div style={{
          position: 'fixed', bottom: 24, left: 24, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: 20,
          background: 'var(--surface)', border: '1px solid var(--border)',
          fontSize: 11, color: 'var(--t3)', pointerEvents: 'auto',
        }}>
          {t('Source:')}&nbsp;
          <a href={imslpSource.pageUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: '#fbbf24', textDecoration: 'none', fontWeight: 600 }}>
            IMSLP
          </a>
        </div>
      )}

      {/* Toast notifications */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-50">
        {toasts.map(toast => (
          <div key={toast.id}
            onClick={toast.onClick}
            className="text-sm px-4 py-2.5 rounded-xl backdrop-blur-sm shadow-lg whitespace-nowrap"
            style={{
              background: 'var(--float-bg)', color: '#e2e8f0', border: '1px solid var(--float-border)',
              cursor: toast.onClick ? 'pointer' : 'default',
              pointerEvents: toast.onClick ? 'auto' : 'none',
            }}>
            {toast.msg}
          </div>
        ))}
      </div>

      {/* Export modal */}
      {showExportModal && pdfUrl && (
        <ExportModal
          defaultName={buildSuggestedFilename(pdfUrl, scoreName)}
          hasHiddenLayers={hiddenOwners.size > 0}
          onConfirm={handleExportConfirm}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Nickname modal */}
      {showNicknameModal && (
        <NicknameModal
          defaultValue={nicknameModalDefault}
          dismissible={pendingRoomId === null}
          onConfirm={confirmNickname}
          onClose={() => setShowNicknameModal(false)}
        />
      )}

      {/* Raised hands panel (host only) */}
      {showHandsPanel && isHost && (
        <RaisedHandsPanel
          raisedHands={raisedHands}
          nicknameMap={nicknameMap}
          mySocketId={mySocketId}
          soundMuted={handSoundMuted}
          rightOffset={
            chatOpen ? 314
            : toolbarPos === 'right' ? 206
            : 14
          }
          onMuteToggle={() => {
            setHandSoundMuted(prev => {
              const next = !prev;
              try { localStorage.setItem('unino_hand_muted', next ? '1' : '0'); } catch {}
              return next;
            });
          }}
          onDismiss={socketId => socket.emit('dismiss-hand', { roomId, socketId })}
          onDismissAll={() => raisedHands.forEach(sid => socket.emit('dismiss-hand', { roomId, socketId: sid }))}
          onClose={() => setShowHandsPanel(false)}
        />
      )}

      {/* Layers popover */}
      {layersOpen && (
        <LayersPopover
          owners={owners}
          hiddenOwners={hiddenOwners}
          colorMode={colorMode}
          isHost={isHost}
          people={colorPeople}
          onSetPersonColor={setPersonColor}
          onSetColorMode={setRoomColorMode}
          rightOffset={
            chatOpen ? 314
            : toolbarPos === 'right' ? 206
            : 14
          }
          onToggle={ownerId => setHiddenOwners(prev => {
            const n = new Set(prev);
            if (n.has(ownerId)) n.delete(ownerId); else n.add(ownerId);
            return n;
          })}
          onShowAll={() => setHiddenOwners(new Set())}
          onOnlyMine={() => {
            const otherIds = owners.filter(o => !o.isMe).map(o => o.ownerId);
            setHiddenOwners(new Set(otherIds));
          }}
          onClose={() => setLayersOpen(false)}
        />
      )}

      {/* Follow the teacher (students only) */}
      {!isHost && roomId && (
        <div style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)', zIndex: 30,
          top: toolbarPos === 'top' ? (isNarrow ? 'calc(156px + env(safe-area-inset-top))' : 62) : 12,
        }}>
          {followTeacher ? (
            <button onClick={() => { followRef.current = false; setFollowTeacher(false); }}
              title={t("Stop following the teacher's page and scroll")}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full shadow-sm"
              style={{ background: 'rgba(99,102,241,0.12)', color: '#4f46e5', border: '1px solid rgba(99,102,241,0.25)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: '#6366f1' }} />
              {t('Following teacher')}
            </button>
          ) : (
            <button onClick={resumeFollowing}
              title={t('Go back to where the teacher is and follow again')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full shadow-md"
              style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>
              {t('Browsing on your own · Follow teacher')}
            </button>
          )}
        </div>
      )}

      {/* Symbol menu (right-click / long-press on the score) */}
      {symbolMenu && (
        <SymbolPopover
          left={symbolMenu.clientX + 4}
          top={symbolMenu.clientY + 4}
          recent={recentSymbols}
          onPick={id => {
            handleAnnotationAdd(makeSymbolAnnotation(id, symbolMenu.page, symbolMenu.x, symbolMenu.y,
              symbolEmForPage(symbolMenu.page), symbolMenu.asp, color));
            rememberSymbol(id);
            setSymbolMenu(null);
          }}
          onClose={() => setSymbolMenu(null)}
        />
      )}

      {/* Measures (OMR) panel */}
      {omrOpen && roomId && (
        <OMRPanel
          state={omrState}
          isHost={isHost}
          prefs={omrPrefs}
          musicXmlUrl={backendUrl(`/omr/${roomId}/musicxml`)}
          rightOffset={
            chatOpen ? 314
            : toolbarPos === 'right' ? 206
            : 14
          }
          onPrefsChange={setOmrPrefs}
          onDetect={() => socket.emit('omr-detect', roomId)}
          onJump={handleMeasureJump}
          onClearHighlight={() => setHighlightedMeasure(null)}
          onClose={() => setOmrOpen(false)}
        />
      )}

      {/* Tuner panel */}
      {tunerOpen && (
        <TunerPanel
          reading={pitchReading}
          error={pitchError}
          instrument={pitchInstrument}
          a4Ref={pitchA4Ref}
          onInstrumentChange={setPitchInstrument}
          onA4Change={setPitchA4Ref}
          onClose={() => setTunerOpen(false)}
        />
      )}

      {/* Live pitch trace widget */}
      {pitchLiveOpen && (
        <PitchTrace
          pitchReading={pitchReading}
          a4Ref={pitchA4Ref}
          remotePitches={remotePitches}
          shareEnabled={pitchShareEnabled}
          onShareChange={setPitchShareEnabled}
          onClose={() => { setPitchLiveOpen(false); setPitchShareEnabled(false); }}
          myName={
            (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] ||
            user?.email?.split('@')[0] || 'Me'
          }
        />
      )}

      {/* Metronome panel */}
      {metronomePanelOpen && (
        <MetronomePanel
          isHost={isHost}
          roomId={roomId}
          remoteState={remoteMetronomeState}
          onUpdate={handleMetronomeUpdate}
          onClose={() => setMetronomePanelOpen(false)}
        />
      )}
    </div>
  );
}
