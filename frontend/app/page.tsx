'use client';

import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import PDFViewer from './PDFViewer';

const socket = io('http://localhost:3001');

export default function Home() {
  const [stage, setStage] = useState<'home' | 'room'>('home');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [activeTool, setActiveTool] = useState('circle');
  const [color, setColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [undoStack, setUndoStack] = useState<any[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('room');
    if (rid) joinRoom(rid);

    socket.on('load-shapes', (existing) => setAnnotations(existing));
    socket.on('new-shape', (shape) => setAnnotations(prev => [...prev, shape]));
    socket.on('clear', () => setAnnotations([]));
    socket.on('undo', () => setAnnotations(prev => prev.slice(0, -1)));
    socket.on('delete-shape', (id) => setAnnotations(prev => prev.filter(a => a.id !== id)));

    return () => {
      socket.off('load-shapes');
      socket.off('new-shape');
      socket.off('clear');
      socket.off('undo');
      socket.off('delete-shape');
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
    window.history.pushState({}, '', '/');
  }

  function copyLink() {
    navigator.clipboard.writeText(`http://localhost:3000?room=${roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleAnnotationAdd(annotation: any) {
    setAnnotations(prev => [...prev, annotation]);
    setUndoStack(prev => [...prev, annotation.id]);
    socket.emit('new-shape', { roomId, shape: annotation });
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

  const tools = [
    { id: 'select', icon: '↖️', label: 'Select' },
    { id: 'circle', icon: '⭕', label: 'Circle' },
    { id: 'pen', icon: '✏️', label: 'Pen' },
    { id: 'line', icon: '📏', label: 'Line' },
    { id: 'highlight', icon: '🖍️', label: 'Highlight' },
    { id: 'text', icon: '📝', label: 'Text' },
  ];

  // HOME
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

  // ROOM
  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <button
          onClick={goHome}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors mr-1 text-gray-400 hover:text-white"
          title="Back to Home"
        >
          <span>🎵</span>
          <span className="text-xs font-semibold">Scoreflow</span>
        </button>

        <div className="w-px h-5 bg-gray-700" />

        {tools.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTool(t.id)}
            title={t.label}
            className={`w-9 h-9 rounded-lg flex items-center justify-center text-base transition-all ${
              activeTool === t.id
                ? 'bg-white/15 text-white border-b-2 border-white'
                : 'hover:bg-white/10 text-gray-300'
            }`}
          >
            {t.icon}
          </button>
        ))}

        <div className="w-px h-5 bg-gray-700" />

        <input
          type="color"
          value={color}
          onChange={e => setColor(e.target.value)}
          className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent"
          title="Color"
        />

        {/* Stroke width */}
        <div className="flex items-center gap-2 px-2">
          <span className="text-xs text-gray-500">Size</span>
          <input
            type="range"
            min={1}
            max={20}
            value={strokeWidth}
            onChange={e => setStrokeWidth(Number(e.target.value))}
            className="w-20 accent-white"
          />
          <span className="text-xs text-gray-400 w-4">{strokeWidth}</span>
        </div>

        <div className="w-px h-5 bg-gray-700" />

        <button onClick={undo} className="px-2.5 h-8 rounded-lg text-xs text-gray-400 hover:bg-white/10 hover:text-white transition-colors">↩ Undo</button>
        <button onClick={clearAll} className="px-2.5 h-8 rounded-lg text-xs text-gray-400 hover:bg-white/10 hover:text-white transition-colors">🗑 Clear</button>

        <button
          onClick={copyLink}
          className={`ml-auto px-4 h-8 rounded-lg text-xs font-semibold transition-all ${
            copied ? 'bg-green-600 text-white' : 'bg-white text-gray-900 hover:bg-gray-100'
          }`}
        >
          {copied ? '✓ Copied!' : '🔗 Share Link'}
        </button>
      </div>

      {/* PDF Viewer */}
      <div className="flex-1 overflow-hidden">
        {pdfUrl && (
          <PDFViewer
            pdfUrl={pdfUrl}
            annotations={annotations}
            activeTool={activeTool}
            color={color}
            strokeWidth={strokeWidth}
            onAnnotationAdd={handleAnnotationAdd}
            onAnnotationUpdate={handleAnnotationUpdate}
            onAnnotationDelete={handleAnnotationDelete}
          />
        )}
      </div>
    </div>
  );
}