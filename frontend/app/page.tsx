'use client';

import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import PDFViewer from './PDFViewer';
import MetronomePanel, { type MetronomeState } from './MetronomePanel';
import Toolbar, { type ToolbarPos } from './Toolbar';
import AuthModal from './AuthModal';
import Sidebar from './Sidebar';
import { exportAnnotatedPDF, buildSuggestedFilename } from './exportAnnotatedPDF';
import ExportModal from './ExportModal';
import { upsertSession, fetchRecentSessions, type RecentSession } from '../lib/sessions';
import AccountPanel, { type PanelTab, type Theme } from './AccountPanel';
import ChatPanel, { type ChatMessage } from './ChatPanel';
import ThumbnailPanel from './ThumbnailPanel';
import TunerPanel from './TunerPanel';
import PitchTrace, { type RemotePitchEntry } from './PitchTrace';
import { usePitch } from '../hooks/usePitch';
import type { InstrumentKey } from '../lib/pitch';

const socket = io('http://localhost:3001');
const POS_KEY = 'unino_toolbar_pos';

// ── Floating action cluster icons ─────────────────────────────────────────────
const FC_ICONS: Record<string, React.ReactNode> = {
  pages:        (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
  chat:         <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  metronome:    (<><path d="M12 22V8" /><path d="M5 22h14" /><path d="M9 8h6" /><path d="M12 4v4" /><path d="M8.5 15.5 12 8l3.5 7.5" /></>),
  bookmark:     <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />,
  bookmarkFill: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="currentColor" />,
  download:     (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>),
  tuner:        (<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>),
  pitchlive:    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
};

interface FloatingClusterProps {
  thumbsOpen: boolean; onToggleThumbs: () => void;
  chatOpen: boolean; chatUnread: number; onToggleChat: () => void;
  metronomePanelOpen: boolean; onToggleMetronome: () => void;
  bookmarkActive: boolean; onToggleBookmark: () => void;
  tunerOpen: boolean; onToggleTuner: () => void;
  pitchLiveOpen: boolean; onTogglePitchLive: () => void;
  onExportPDF: () => void;
  rightOffset: number;
}

function FloatingCluster(p: FloatingClusterProps) {
  function FBtn({ icon, active, onClick, title, amber, badge }: {
    icon: string; active: boolean; onClick: () => void; title: string; amber?: boolean; badge?: number;
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
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', right: p.rightOffset, top: '50%', transform: 'translateY(-50%)', transition: 'right 0.2s ease',
      zIndex: 40, display: 'flex', flexDirection: 'column', gap: 2,
      background: 'rgba(18,18,26,0.84)', backdropFilter: 'blur(18px) saturate(1.6)',
      borderRadius: 14, padding: 6, border: '1px solid rgba(255,255,255,0.09)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.32)',
    }}>
      <FBtn icon="pages"     active={p.thumbsOpen}          onClick={p.onToggleThumbs}      title="Page thumbnails" />
      <FBtn icon="chat"      active={p.chatOpen}            onClick={p.onToggleChat}         title="Chat" badge={p.chatOpen ? 0 : p.chatUnread} />
      <FBtn icon="metronome" active={p.metronomePanelOpen}  onClick={p.onToggleMetronome}    title="Metronome" />
      <FBtn icon={p.bookmarkActive ? 'bookmarkFill' : 'bookmark'} active={p.bookmarkActive} onClick={p.onToggleBookmark} title={p.bookmarkActive ? 'Remove bookmark' : 'Bookmark this page'} amber />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 2px' }} />
      <FBtn icon="tuner"     active={p.tunerOpen}           onClick={p.onToggleTuner}        title="Tuner" />
      <FBtn icon="pitchlive" active={p.pitchLiveOpen}       onClick={p.onTogglePitchLive}    title="Live Pitch" />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 2px' }} />
      <FBtn icon="download"  active={false}                 onClick={p.onExportPDF}          title="Export PDF" />
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Home() {
  const [stage, setStage] = useState<'home' | 'room'>('home');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [activeTool, setActiveTool] = useState('pen');
  const [eraserMode, setEraserMode] = useState<'stroke' | 'pixel'>('stroke');
  const [color, setColor] = useState('#ff3b30');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [undoStack, setUndoStack] = useState<
    ({ action: 'add'; id: string } | { action: 'delete'; annotation: any })[]
  >([]);

  // Identity & role
  const [mySocketId, setMySocketId] = useState('');
  const [isHost, setIsHost] = useState(false);

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
  const [toasts, setToasts] = useState<{ id: string; msg: string }[]>([]);

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

  // Persist bookmarks to localStorage whenever they change
  useEffect(() => {
    if (!roomId) return;
    localStorage.setItem(`unino_bookmarks_${roomId}`, JSON.stringify(bookmarks));
  }, [bookmarks, roomId]);

  // Scroll sync & presence
  const [scrollSyncEnabled, setScrollSyncEnabled] = useState(false);
  const [remoteScrollPosition, setRemoteScrollPosition] = useState<number | null>(null);
  const [participantCount, setParticipantCount] = useState(0);

  // Toolbar position
  const [toolbarPos, setToolbarPosState] = useState<ToolbarPos>('top');
  useEffect(() => {
    const saved = localStorage.getItem(POS_KEY) as ToolbarPos | null;
    if (saved === 'top' || saved === 'left' || saved === 'right') setToolbarPosState(saved);
  }, []);

  // ── Theme ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('unino_theme') as Theme | null;
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

  // ── Shared helpers ────────────────────────────────────────────────────────
  function changeToolbarPos(p: ToolbarPos) {
    setToolbarPosState(p);
    localStorage.setItem(POS_KEY, p);
  }

  function addToast(msg: string) {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }

  useEffect(() => {
    if (socket.connected) setMySocketId(socket.id!);
    socket.on('connect', () => {
      setMySocketId(socket.id!);
      if (roomIdRef.current) socket.emit('join-room', roomIdRef.current);
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
    });

    socket.on('page-changed', (page: number) => setCurrentPage(page));

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

    socket.on('raise-hand', ({ socketId }: { socketId: string }) => {
      setRaisedHands(prev => prev.includes(socketId) ? prev : [...prev, socketId]);
      const label = socketId === socket.id ? 'You' : `User #${socketId.slice(-4).toUpperCase()}`;
      addToast(`${label} raised their hand ✋`);
    });
    socket.on('lower-hand', ({ socketId }: { socketId: string }) => {
      setRaisedHands(prev => prev.filter(id => id !== socketId));
    });

    socket.on('scroll-sync', (ratio: number) => setRemoteScrollPosition(ratio));
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
      socket.off('scroll-sync'); socket.off('room-members-count');
      socket.off('metronome-update');
      socket.off('chat-history'); socket.off('chat-message');
      socket.off('bookmark-add'); socket.off('bookmark-remove');
      socket.off('pitch-update');
    };
  }, []);

  async function joinRoom(rid: string) {
    const match = rid.match(/room=([a-f0-9-]{36})/);
    const cleanId = match ? match[1] : rid.trim();
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/room/${cleanId}`);
      if (!res.ok) { alert('Room not found!'); setLoading(false); return; }
      const data = await res.json();
      const sn = data.scoreName || 'Untitled Score';
      setScoreName(sn);
      if (user) {
        upsertSession(user.id, cleanId, sn).then(() =>
          fetchRecentSessions(user.id).then(setRecentSessions),
        );
      }
      setPdfUrl(data.pdfUrl);
      setCurrentPage(data.currentPage ?? 0);
      setRoomId(cleanId);
      const savedBM = localStorage.getItem(`unino_bookmarks_${cleanId}`);
      setBookmarks(savedBM ? JSON.parse(savedBM) : []);
      setStage('room');
      socket.emit('join-room', cleanId);
      window.history.pushState({}, '', `?room=${cleanId}`);
    } catch { alert('Could not connect.'); }
    setLoading(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append('pdf', file);
    const uploadRes = await fetch('http://localhost:3001/upload', { method: 'POST', body: formData });
    const { url, scoreName: uploadedName } = await uploadRes.json();
    const sn = uploadedName || file.name.replace(/\.pdf$/i, '').trim() || 'Untitled Score';
    setScoreName(sn);
    const res = await fetch('http://localhost:3001/create-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfUrl: url, scoreName: sn, creatorId: user?.id ?? null }),
    });
    const { roomId: rid } = await res.json();
    if (user) {
      upsertSession(user.id, rid, sn).then(() =>
        fetchRecentSessions(user.id).then(setRecentSessions),
      );
    }
    setPdfUrl(url);
    setCurrentPage(0);
    setRoomId(rid);
    setBookmarks([]);
    setIsHost(true);
    setStage('room');
    socket.emit('join-room', rid);
    window.history.pushState({}, '', `?room=${rid}`);
    setLoading(false);
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
    const senderName =
      (user?.user_metadata?.full_name as string | undefined)?.trim() ||
      user?.email?.split('@')[0] ||
      'Guest';
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
    setTunerOpen(false);
    setPitchLiveOpen(false);
    setPitchShareEnabled(false);
    setRemotePitches({});
    Object.values(remotePitchTimers.current).forEach(clearTimeout);
    remotePitchTimers.current = {};
    window.history.pushState({}, '', '/');
  }

  function copyLink() {
    navigator.clipboard.writeText(`http://localhost:3000?room=${roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleAnnotationAdd(annotation: any) {
    const { _skipUndo, ...rest } = annotation;
    const withOwner = { ...rest, ownerId: rest.ownerId ?? socket.id };
    setAnnotations(prev => prev.some(a => a.id === withOwner.id) ? prev : [...prev, withOwner]);
    if (!_skipUndo) setUndoStack(prev => [...prev, { action: 'add', id: withOwner.id }]);
    socket.emit('new-shape', { roomId, shape: withOwner });
  }

  function handleAnnotationDelete(id: string) {
    setAnnotations(prev => {
      const ann = prev.find(a => a.id === id);
      if (ann && (isHost || ann.ownerId === socket.id)) {
        setUndoStack(u => [...u, { action: 'delete', annotation: ann }]);
      }
      return prev.filter(a => a.id !== id);
    });
    socket.emit('delete-shape', { roomId, id });
  }

  function undo() {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    if (last.action === 'add') {
      setAnnotations(prev => prev.filter(a => a.id !== last.id));
      socket.emit('undo', { roomId, id: last.id });
    } else {
      const ann = last.annotation;
      setAnnotations(prev => prev.some(a => a.id === ann.id) ? prev : [...prev, ann]);
      socket.emit('new-shape', { roomId, shape: ann });
    }
  }

  function clearAll() {
    setAnnotations([]);
    setUndoStack([]);
    socket.emit('clear', roomId);
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

  function handlePageChange(page: number, fromScroll = false) {
    if (page < 0 || page >= numPages || page === currentPage) return;
    setCurrentPage(page);
    if (isHost && (!fromScroll || scrollSyncEnabled)) {
      socket.emit('change-page', { roomId, page });
    }
  }

  function handleMetronomeUpdate(state: MetronomeState) {
    socket.emit('metronome-update', { roomId, state });
  }

  async function handleExportPDF() {
    if (!pdfUrl) return;
    if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
      const suggested = buildSuggestedFilename(pdfUrl, scoreName) + '.pdf';
      try {
        await exportAnnotatedPDF(pdfUrl, annotations, suggested);
      } catch (err: any) {
        if (err?.name !== 'AbortError') addToast('Export failed');
      }
    } else {
      setShowExportModal(true);
    }
  }

  async function handleExportConfirm(filename: string) {
    setShowExportModal(false);
    if (!pdfUrl) return;
    try {
      await exportAnnotatedPDF(pdfUrl, annotations, filename);
      addToast('Saved to Downloads folder');
    } catch {
      addToast('Export failed');
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
          <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />

          {/* ── Header ── */}
          <header className="relative z-20 px-10 py-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🎵</span>
              <span className="text-lg font-bold tracking-tight">Unino</span>
            </div>

            {!authLoading && (
              user ? (
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setShowUserMenu(o => !o)}
                    className="w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center text-sm font-bold text-white transition-colors select-none"
                  >
                    {getInitial()}
                  </button>

                  {showUserMenu && (
                    <div className="unino-modal absolute right-0 top-11 rounded-xl py-1.5 w-48 shadow-2xl z-50"
                      style={{ backgroundColor: 'var(--modal-bg)', border: '1px solid var(--border-md)' }}>
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
                          {label}
                        </button>
                      ))}
                      <div className="mt-1 pt-1" style={{ borderTop: '1px solid var(--divider)' }}>
                        <button
                          onClick={handleSignOut}
                          className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors"
                        >
                          Log out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white transition-colors"
                >
                  Sign in
                </button>
              )
            )}
          </header>

          {/* ── Main content ── */}
          <main className="relative z-10 flex flex-col items-center justify-center px-6 pt-8 pb-32 text-center flex-1">
            {/* Hero — logged out only */}
            {!user && (
              <>
                <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-sm text-gray-400 mb-8">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  Real-time sheet music collaboration
                </div>
                <h1 className="text-6xl font-bold mb-6 leading-tight">
                  <span className="unino-hero-gradient bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent">
                    Annotate music.<br />Together.
                  </span>
                </h1>
                <p className="text-gray-400 text-xl mb-16 max-w-lg">
                  Upload your score, share a link, and annotate in real time — with anyone.
                </p>
              </>
            )}

            {/* Welcome — logged in only */}
            {user && (
              <div className="mb-10 text-left w-full max-w-2xl">
                <h2 className="text-3xl font-bold mb-1.5">
                  Welcome back{displayName ? `, ${displayName}` : ''} 👋
                </h2>
                <p className="text-gray-400 text-sm">Ready to collaborate?</p>
              </div>
            )}

            {/* Recent sessions — logged-in only */}
            {user && (
              <div className="w-full max-w-2xl mb-10 text-left">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Recent</h3>
                  {recentSessions.length > 5 && (
                    <button
                      onClick={() => setShowAllSessions(s => !s)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      {showAllSessions ? 'Show less' : `See all ${recentSessions.length} →`}
                    </button>
                  )}
                </div>

                {recentSessions.length === 0 ? (
                  <div className="flex items-center gap-3 rounded-2xl px-5 py-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <span className="text-2xl">🎵</span>
                    <div>
                      <p className="text-sm text-gray-400 font-medium">No recent sessions yet</p>
                      <p className="text-xs text-gray-600 mt-0.5">Upload a score below to start your first session.</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {(showAllSessions ? recentSessions : recentSessions.slice(0, 5)).map(s => (
                      <button
                        key={s.id}
                        onClick={() => joinRoom(s.room_id)}
                        className="flex items-center gap-4 rounded-2xl px-5 py-3.5 text-left transition-all duration-200 group hover:opacity-80"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                      >
                        <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-base">🎼</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate u-text">{s.score_name}</p>
                          <p className="text-xs text-gray-600 mt-0.5">{relativeTime(s.last_accessed)}</p>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-2xl">
              <div className="rounded-3xl p-8 flex flex-col items-start gap-5 transition-all duration-300 text-left"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="w-14 h-14 bg-indigo-500/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center text-2xl">🎼</div>
                <div>
                  <h2 className="text-xl font-bold mb-2 u-text">Start a session</h2>
                  <p className="text-gray-400 text-sm leading-relaxed">Upload a PDF score and create a room. Share the link with anyone to collaborate.</p>
                </div>
                <label className={`w-full py-3 rounded-xl text-sm font-semibold text-center cursor-pointer transition-colors ${loading ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
                  {loading ? 'Uploading…' : '+ Upload Score'}
                  <input type="file" accept=".pdf" onChange={handleUpload} className="hidden" disabled={loading} />
                </label>
              </div>

              <div className="rounded-3xl p-8 flex flex-col items-start gap-5 transition-all duration-300 text-left"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="w-14 h-14 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-2xl">🔗</div>
                <div>
                  <h2 className="text-xl font-bold mb-2 u-text">Join a session</h2>
                  <p className="text-gray-400 text-sm leading-relaxed">Paste the link or room code you received to join a live session.</p>
                </div>
                <div className="w-full flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="Paste link or room code…"
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && joinCode && joinRoom(joinCode)}
                    className="w-full rounded-xl px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none transition-colors u-text"
                    style={{ background: 'var(--surface-hover)', border: '1px solid var(--border-md)' }}
                  />
                  <button
                    onClick={() => joinCode && joinRoom(joinCode)}
                    disabled={loading || !joinCode}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40"
                  >
                    {loading ? 'Joining…' : 'Join Session →'}
                  </button>
                </div>
              </div>
            </div>
          </main>

          {!user && (
            <footer className="relative z-10 text-center text-gray-600 text-sm pb-8">
              Built for musicians 🎻
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

  const toolbarProps = {
    pos: toolbarPos,
    onPosChange: changeToolbarPos,
    activeTool,
    setActiveTool,
    eraserMode,
    setEraserMode,
    color,
    setColor,
    strokeWidth,
    setStrokeWidth,
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
  };

  return (
    <div
      className="flex overflow-hidden h-screen"
      style={{ background: 'var(--app-bg)', color: 'var(--t)', flexDirection: toolbarPos === 'top' ? 'column' : 'row' }}
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
              annotations={annotations}
              activeTool={activeTool}
              eraserMode={eraserMode}
              color={color}
              strokeWidth={strokeWidth}
              isHost={isHost}
              mySocketId={mySocketId}
              remoteLasers={remoteLasers}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              onNumPagesLoaded={setNumPages}
              onAnnotationAdd={handleAnnotationAdd}
              onAnnotationDelete={handleAnnotationDelete}
              onLaserMove={handleLaserMove}
              onLaserStop={handleLaserStop}
              scrollSyncEnabled={scrollSyncEnabled}
              remoteScrollPosition={remoteScrollPosition}
              onScrollPositionChange={handleScrollPositionChange}
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
        onExportPDF={handleExportPDF}
        rightOffset={
          chatOpen ? 314
          : toolbarPos === 'right' ? 206
          : 14
        }
      />

      {/* Toast notifications */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-50 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="text-sm px-4 py-2.5 rounded-xl backdrop-blur-sm shadow-lg whitespace-nowrap"
            style={{ background: 'var(--float-bg)', color: '#e2e8f0', border: '1px solid var(--float-border)' }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* Export modal */}
      {showExportModal && pdfUrl && (
        <ExportModal
          defaultName={buildSuggestedFilename(pdfUrl, scoreName)}
          onConfirm={handleExportConfirm}
          onClose={() => setShowExportModal(false)}
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
