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

const socket = io('http://localhost:3001');
const POS_KEY = 'unino_toolbar_pos';

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
  const [remoteMetronomeState, setRemoteMetronomeState] = useState<MetronomeState | null>(null);

  const roomIdRef = useRef<string | null>(null);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

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
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) setShowAuthModal(false);
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
    await supabase.auth.signOut();
    setShowUserMenu(false);
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

    socket.on('load-shapes', (existing) => setAnnotations(existing));
    socket.on('new-shape', (shape) => setAnnotations(prev => [...prev, shape]));
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

    return () => {
      socket.off('connect');
      socket.off('load-shapes'); socket.off('new-shape'); socket.off('clear');
      socket.off('delete-shape'); socket.off('update-shape'); socket.off('undo');
      socket.off('room-info'); socket.off('page-changed');
      socket.off('laser-move'); socket.off('laser-stop');
      socket.off('raise-hand'); socket.off('lower-hand');
      socket.off('scroll-sync'); socket.off('room-members-count');
      socket.off('metronome-update');
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
      setPdfUrl(data.pdfUrl);
      setCurrentPage(data.currentPage ?? 0);
      setRoomId(cleanId);
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
    const { url } = await uploadRes.json();
    const res = await fetch('http://localhost:3001/create-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfUrl: url, creatorId: user?.id ?? null }),
    });
    const { roomId: rid } = await res.json();
    setPdfUrl(url);
    setCurrentPage(0);
    setRoomId(rid);
    setIsHost(true);
    setStage('room');
    socket.emit('join-room', rid);
    window.history.pushState({}, '', `?room=${rid}`);
    setLoading(false);
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
    setAnnotations(prev => [...prev, withOwner]);
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
      setAnnotations(prev => [...prev, ann]);
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

  // ── HOME ──────────────────────────────────────────────────────────────────
  if (stage === 'home') {
    const displayName =
      ((user?.user_metadata?.full_name as string) ?? '').split(' ')[0] ||
      user?.email?.split('@')[0];

    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex">
        {user && (
          <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen(o => !o)} />
        )}

        <div className="relative flex-1 flex flex-col overflow-hidden">
          {/* ambient glow */}
          <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />

          {/* ── Header ── */}
          <header className="relative z-10 px-10 py-6 flex items-center justify-between">
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
                    <div className="absolute right-0 top-11 bg-[#111118] border border-white/10 rounded-xl py-1.5 w-48 shadow-2xl z-50">
                      <div className="px-4 py-2.5 border-b border-white/5 mb-1">
                        <p className="text-sm font-medium text-white truncate">
                          {(user.user_metadata?.full_name as string) || user.email}
                        </p>
                        {user.user_metadata?.full_name && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{user.email}</p>
                        )}
                      </div>
                      {(['Profile', 'My Sessions', 'Settings'] as const).map(label => (
                        <button
                          key={label}
                          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                        >
                          {label}
                        </button>
                      ))}
                      <div className="border-t border-white/5 mt-1 pt-1">
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
                  <span className="bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent">
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

            {/* Action cards — always shown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-2xl">
              <div className="bg-white/5 hover:bg-white/[0.08] border border-white/10 hover:border-white/20 rounded-3xl p-8 flex flex-col items-start gap-5 transition-all duration-300 text-left">
                <div className="w-14 h-14 bg-indigo-500/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center text-2xl">🎼</div>
                <div>
                  <h2 className="text-xl font-bold mb-2">Start a session</h2>
                  <p className="text-gray-400 text-sm leading-relaxed">Upload a PDF score and create a room. Share the link with anyone to collaborate.</p>
                </div>
                <label className={`w-full py-3 rounded-xl text-sm font-semibold text-center cursor-pointer transition-colors ${loading ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
                  {loading ? 'Uploading…' : '+ Upload Score'}
                  <input type="file" accept=".pdf" onChange={handleUpload} className="hidden" disabled={loading} />
                </label>
              </div>

              <div className="bg-white/5 hover:bg-white/[0.08] border border-white/10 hover:border-white/20 rounded-3xl p-8 flex flex-col items-start gap-5 transition-all duration-300 text-left">
                <div className="w-14 h-14 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-2xl">🔗</div>
                <div>
                  <h2 className="text-xl font-bold mb-2">Join a session</h2>
                  <p className="text-gray-400 text-sm leading-relaxed">Paste the link or room code you received to join a live session.</p>
                </div>
                <div className="w-full flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="Paste link or room code…"
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && joinCode && joinRoom(joinCode)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition-colors"
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
  };

  return (
    <div
      className="flex overflow-hidden h-screen bg-[#f5f5f7] text-gray-900"
      style={{ flexDirection: toolbarPos === 'top' ? 'column' : 'row' }}
    >
      {toolbarPos !== 'right' && <Toolbar key={toolbarPos} {...toolbarProps} />}

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

      {toolbarPos === 'right' && <Toolbar key={toolbarPos} {...toolbarProps} />}

      {/* Toast notifications */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-50 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="bg-gray-900/90 text-white text-sm px-4 py-2.5 rounded-xl backdrop-blur-sm shadow-lg whitespace-nowrap">
            {t.msg}
          </div>
        ))}
      </div>

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
