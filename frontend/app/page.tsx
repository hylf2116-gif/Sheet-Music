'use client';

import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import PDFViewer from './PDFViewer';

const socket = io('http://localhost:3001');

const ICONS: Record<string, React.ReactNode> = {
  select: <path d="M5 3l14 7-6 2-2 6z" fill="currentColor" stroke="none" />,
  ellipse: <ellipse cx="12" cy="12" rx="10" ry="6" />,
  pen: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  line: <path d="M5 19 19 5" />,
  highlight: (
    <>
      <path d="M9 11l-6 6v3h9l3-3" />
      <path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </>
  ),
  eraser: (
    <>
      <path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21" />
      <path d="M22 21H7" />
    </>
  ),
  text: (
    <>
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v16" />
    </>
  ),
  laser: (
    <>
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="7" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <line x1="2" y1="12" x2="7" y2="12" />
      <line x1="17" y1="12" x2="22" y2="12" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H9" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  link: (
    <>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <path d="M8 12h8" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
};

function Icon({ name, className = 'w-[18px] h-[18px]' }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {ICONS[name]}
    </svg>
  );
}

const PRESET_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#1c1c1e'];
const STROKE_SIZES = [
  { label: 'Thin', w: 2, dot: 5 },
  { label: 'Medium', w: 4, dot: 8 },
  { label: 'Thick', w: 8, dot: 12 },
];

const TOOLS = [
  { id: 'pen',       label: 'Pen' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'ellipse',   label: 'Ellipse' },
  { id: 'line',      label: 'Line' },
  { id: 'text',      label: 'Text' },
  { id: 'eraser',    label: 'Eraser' },
  { id: 'select',    label: 'Select' },
  { id: 'laser',     label: 'Laser Pointer' },
];

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
  const [undoStack, setUndoStack] = useState<any[]>([]);

  // Identity & role
  const [mySocketId, setMySocketId] = useState('');
  const [isHost, setIsHost] = useState(false);

  // Raise hand
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<string[]>([]);

  // Laser
  const [remoteLasers, setRemoteLasers] = useState<{ socketId: string; x: number; y: number; page: number }[]>([]);

  // Toasts
  const [toasts, setToasts] = useState<{ id: string; msg: string }[]>([]);

  function addToast(msg: string) {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }

  useEffect(() => {
    if (socket.connected) setMySocketId(socket.id!);
    socket.on('connect', () => setMySocketId(socket.id!));

    const params = new URLSearchParams(window.location.search);
    const rid = params.get('room');
    if (rid) joinRoom(rid);

    socket.on('load-shapes', (existing) => setAnnotations(existing));
    socket.on('new-shape', (shape) => setAnnotations(prev => [...prev, shape]));
    socket.on('clear', () => setAnnotations([]));
    socket.on('undo', () => setAnnotations(prev => prev.slice(0, -1)));
    socket.on('delete-shape', (id) => setAnnotations(prev => prev.filter(a => a.id !== id)));

    socket.on('room-info', ({ isHost: h, raisedHands: rh }: { isHost: boolean; raisedHands: string[] }) => {
      setIsHost(h);
      setRaisedHands(rh ?? []);
    });

    socket.on('laser-move', ({ socketId, x, y, page }: { socketId: string; x: number; y: number; page: number }) => {
      setRemoteLasers(prev => [...prev.filter(l => l.socketId !== socketId), { socketId, x, y, page }]);
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

    return () => {
      socket.off('connect');
      socket.off('load-shapes'); socket.off('new-shape'); socket.off('clear');
      socket.off('undo'); socket.off('delete-shape'); socket.off('room-info');
      socket.off('laser-move'); socket.off('laser-stop');
      socket.off('raise-hand'); socket.off('lower-hand');
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
      body: JSON.stringify({ pdfUrl: url }),
    });
    const { roomId: rid } = await res.json();
    setPdfUrl(url);
    setRoomId(rid);
    setStage('room');
    socket.emit('join-room', rid);
    window.history.pushState({}, '', `?room=${rid}`);
    setLoading(false);
  }

  function goHome() {
    setStage('home');
    setRoomId(null);
    setPdfUrl(null);
    setAnnotations([]);
    setUndoStack([]);
    setIsHost(false);
    setHandRaised(false);
    setRaisedHands([]);
    setRemoteLasers([]);
    window.history.pushState({}, '', '/');
  }

  function copyLink() {
    navigator.clipboard.writeText(`http://localhost:3000?room=${roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleAnnotationAdd(annotation: any) {
    // Preserve an explicit ownerId (e.g. pixel-erase sub-strokes keep original owner);
    // otherwise stamp with the local socket ID.
    const withOwner = { ...annotation, ownerId: annotation.ownerId ?? socket.id };
    setAnnotations(prev => [...prev, withOwner]);
    setUndoStack(prev => [...prev, withOwner.id]);
    socket.emit('new-shape', { roomId, shape: withOwner });
  }

  function handleAnnotationDelete(id: string) {
    setAnnotations(prev => prev.filter(a => a.id !== id));
    socket.emit('delete-shape', { roomId, id });
  }

  function handleAnnotationUpdate(id: string, changes: any) {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, ...changes } : a));
    socket.emit('update-shape', { roomId, id, changes });
  }

  function undo() {
    if (undoStack.length === 0) return;
    const lastId = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    handleAnnotationDelete(lastId);
  }

  function clearAll() {
    setAnnotations([]);
    setUndoStack([]);
    socket.emit('clear', roomId);
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

  const isCustomColor = !PRESET_COLORS.includes(color);

  // ── HOME ──────────────────────────────────────────────────────────────────
  if (stage === 'home') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white overflow-hidden relative">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />

        <header className="relative z-10 px-10 py-6 flex items-center">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎵</span>
            <span className="text-lg font-bold tracking-tight">Scoreflow</span>
          </div>
        </header>

        <main className="relative z-10 flex flex-col items-center justify-center px-6 pt-16 pb-32 text-center">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-2xl">
            <div className="bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 rounded-3xl p-8 flex flex-col items-start gap-5 transition-all duration-300 text-left">
              <div className="w-14 h-14 bg-indigo-500/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center text-2xl">🎼</div>
              <div>
                <h2 className="text-xl font-bold mb-2">Start a session</h2>
                <p className="text-gray-400 text-sm leading-relaxed">Upload a PDF score and create a room. Share the link with anyone to collaborate.</p>
              </div>
              <label className={`w-full py-3 rounded-xl text-sm font-semibold text-center cursor-pointer transition-colors ${loading ? 'bg-gray-600 text-gray-400' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
                {loading ? 'Uploading...' : '+ Upload Score'}
                <input type="file" accept=".pdf" onChange={handleUpload} className="hidden" disabled={loading} />
              </label>
            </div>

            <div className="bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 rounded-3xl p-8 flex flex-col items-start gap-5 transition-all duration-300 text-left">
              <div className="w-14 h-14 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-2xl">🔗</div>
              <div>
                <h2 className="text-xl font-bold mb-2">Join a session</h2>
                <p className="text-gray-400 text-sm leading-relaxed">Paste the link or room code you received to join a live session.</p>
              </div>
              <div className="w-full flex flex-col gap-2">
                <input
                  type="text"
                  placeholder="Paste link or room code..."
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
                  {loading ? 'Joining...' : 'Join Session →'}
                </button>
              </div>
            </div>
          </div>
        </main>

        <footer className="relative z-10 text-center text-gray-600 text-sm pb-8">
          Built for musicians 🎻
        </footer>
      </div>
    );
  }

  // ── ROOM ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-[#f5f5f7] text-gray-900">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 h-14 bg-white/80 backdrop-blur-xl border-b border-black/[0.06] shrink-0">
        <button
          onClick={goHome}
          className="flex items-center gap-2 pl-1 pr-2.5 h-9 rounded-lg text-gray-800 hover:bg-black/[0.04] transition-colors"
          title="Back to Home"
        >
          <Icon name="music" className="w-[18px] h-[18px] text-indigo-600" />
          <span className="text-sm font-semibold tracking-tight">Scoreflow</span>
        </button>

        <div className="w-px h-6 bg-black/10 mx-1" />

        {/* Drawing + pointer tools */}
        <div className="flex items-center gap-0.5">
          {TOOLS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              title={t.label}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                t.id === 'laser'
                  ? activeTool === t.id
                    ? 'bg-red-50 text-red-500'
                    : 'text-gray-500 hover:bg-red-50 hover:text-red-500'
                  : activeTool === t.id
                    ? 'bg-black/[0.07] text-gray-900'
                    : 'text-gray-500 hover:bg-black/[0.04] hover:text-gray-900'
              }`}
            >
              <Icon name={t.id} />
            </button>
          ))}
        </div>

        {activeTool === 'eraser' && (
          <div className="flex items-center gap-0.5 bg-black/[0.05] rounded-lg p-0.5 ml-1">
            {(['stroke', 'pixel'] as const).map(m => (
              <button
                key={m}
                onClick={() => setEraserMode(m)}
                title={m === 'stroke' ? 'Erase whole strokes on click' : 'Erase by dragging (splits pen strokes)'}
                className={`px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${
                  eraserMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {m === 'stroke' ? 'Stroke' : 'Pixel'}
              </button>
            ))}
          </div>
        )}

        <div className="w-px h-6 bg-black/10 mx-1" />

        {/* Colors */}
        <div className="flex items-center gap-1.5">
          {PRESET_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} title={c}
              className="w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110">
              <span className={`w-[18px] h-[18px] rounded-full transition-shadow ${
                color === c ? 'ring-2 ring-offset-2 ring-offset-white ring-gray-400' : 'ring-1 ring-inset ring-black/10'
              }`} style={{ backgroundColor: c }} />
            </button>
          ))}
          <label title="Custom color"
            className="relative w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110">
            <span className={`w-[18px] h-[18px] rounded-full transition-shadow ${
              isCustomColor ? 'ring-2 ring-offset-2 ring-offset-white ring-gray-400' : 'ring-1 ring-inset ring-black/10'
            }`} style={{ background: isCustomColor ? color : 'conic-gradient(#ff3b30,#ff9500,#ffcc00,#34c759,#007aff,#af52de,#ff3b30)' }} />
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
          </label>
        </div>

        <div className="w-px h-6 bg-black/10 mx-1" />

        {/* Stroke sizes */}
        <div className="flex items-center gap-0.5">
          {STROKE_SIZES.map(s => (
            <button key={s.label} onClick={() => setStrokeWidth(s.w)} title={s.label}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                strokeWidth === s.w ? 'bg-black/[0.07]' : 'hover:bg-black/[0.04]'
              }`}>
              <span className="rounded-full bg-gray-700" style={{ width: s.dot, height: s.dot }} />
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-black/10 mx-1" />

        {/* Undo / Clear */}
        <button onClick={undo} title="Undo"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-black/[0.04] hover:text-gray-900 transition-colors">
          <Icon name="undo" />
        </button>
        <button onClick={clearAll} title="Clear all"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors">
          <Icon name="trash" />
        </button>

        {/* Role badge + raise hand + share — pushed to the right */}
        <div className="ml-auto flex items-center gap-2">
          {isHost ? (
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                <span>👑</span> Host
              </span>
              {raisedHands.length > 0 && (
                <span className="flex items-center gap-1 text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-1">
                  ✋ {raisedHands.length}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 font-medium">Participant</span>
              <button
                onClick={toggleHand}
                title={handRaised ? 'Lower hand' : 'Raise hand'}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors ${
                  handRaised
                    ? 'bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-200'
                    : 'bg-black/[0.04] text-gray-600 hover:bg-black/[0.07]'
                }`}
              >
                ✋ {handRaised ? 'Lower' : 'Raise Hand'}
              </button>
            </div>
          )}

          <button
            onClick={copyLink}
            className={`flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-colors ${
              copied ? 'bg-green-500 text-white' : 'bg-gray-900 text-white hover:bg-gray-700'
            }`}
          >
            <Icon name={copied ? 'check' : 'link'} className="w-4 h-4" />
            {copied ? 'Copied' : 'Share'}
          </button>
        </div>
      </div>

      {/* PDF Viewer */}
      <div className="flex-1 overflow-hidden">
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
            onAnnotationAdd={handleAnnotationAdd}
            onAnnotationUpdate={handleAnnotationUpdate}
            onAnnotationDelete={handleAnnotationDelete}
            onLaserMove={handleLaserMove}
            onLaserStop={handleLaserStop}
          />
        )}
      </div>

      {/* Toast notifications */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-50 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="bg-gray-900/90 text-white text-sm px-4 py-2.5 rounded-xl backdrop-blur-sm shadow-lg whitespace-nowrap">
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
