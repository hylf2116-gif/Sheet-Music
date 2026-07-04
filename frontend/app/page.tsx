'use client';

import { useRef, useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');
type Tool = 'circle' | 'pen' | 'line' | 'highlight' | 'text';

export default function Home() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>('circle');
  const [color, setColor] = useState('#FF0000');
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState<{x: number, y: number} | null>(null);
  const [currentPoints, setCurrentPoints] = useState<{x: number, y: number}[]>([]);
  const [shapes, setShapes] = useState<any[]>([]);
  const [undone, setUndone] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<'home' | 'room'>('home');
  const [browseMode, setBrowseMode] = useState(false);

  useEffect(() => {
    socket.on('load-shapes', (existing) => setShapes(existing));
    socket.on('new-shape', (shape) => setShapes(prev => [...prev, shape]));
    socket.on('undo', () => setShapes(prev => prev.slice(0, -1)));
    socket.on('clear', () => setShapes([]));
    return () => {
      socket.off('load-shapes');
      socket.off('new-shape');
      socket.off('undo');
      socket.off('clear');
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('room');
    if (rid) joinRoom(rid);
  }, []);

  async function joinRoom(rid: string) {
    const res = await fetch(`http://localhost:3001/room/${rid}`);
    if (!res.ok) { alert('Room not found!'); return; }
    const data = await res.json();
    setPdfUrl(data.pdfUrl);
    setRoomId(rid);
    setStage('room');
    socket.emit('join-room', rid);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('pdf', file);

    const uploadRes = await fetch('http://localhost:3001/upload', {
      method: 'POST',
      body: formData,
    });
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
  }

  function getPos(e: React.MouseEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function addShape(shape: any) {
    setShapes(prev => [...prev, shape]);
    socket.emit('new-shape', { roomId, shape });
    setUndone([]);
  }

  function undo() {
    if (shapes.length === 0) return;
    setUndone(prev => [...prev, shapes[shapes.length - 1]]);
    setShapes(prev => prev.slice(0, -1));
    socket.emit('undo', roomId);
  }

  function redo() {
    if (undone.length === 0) return;
    setShapes(prev => [...prev, undone[undone.length - 1]]);
    setUndone(prev => prev.slice(0, -1));
  }

  function clearAll() {
    setShapes([]); setUndone([]);
    socket.emit('clear', roomId);
  }

  function onMouseDown(e: React.MouseEvent) {
    if (tool === 'text') {
      const pos = getPos(e);
      const text = window.prompt('Enter text:');
      if (text) addShape({ type: 'text', x: pos.x, y: pos.y, text, color });
      return;
    }
    const pos = getPos(e);
    setDrawing(true); setStart(pos);
    if (tool === 'pen') setCurrentPoints([pos]);
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drawing || !start) return;
    const pos = getPos(e);
    if (tool === 'pen') {
      setCurrentPoints(prev => [...prev, pos]);
    } else if (tool === 'circle') {
      const r = Math.sqrt(Math.pow(pos.x - start.x, 2) + Math.pow(pos.y - start.y, 2));
      setPreview({ type: 'circle', x: start.x, y: start.y, r, color });
    } else if (tool === 'line') {
      setPreview({ type: 'line', x1: start.x, y1: start.y, x2: pos.x, y2: pos.y, color });
    } else if (tool === 'highlight') {
      setPreview({ type: 'highlight', x: Math.min(start.x, pos.x), y: Math.min(start.y, pos.y), w: Math.abs(pos.x - start.x), h: Math.abs(pos.y - start.y), color });
    }
  }

  function onMouseUp() {
    if (!drawing || !start) return;
    if (tool === 'pen' && currentPoints.length > 1) addShape({ type: 'pen', points: currentPoints, color });
    else if (preview) addShape(preview);
    setDrawing(false); setStart(null); setCurrentPoints([]); setPreview(null);
  }

  function renderShape(s: any, i: number) {
    if (s.type === 'circle') return <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="none" stroke={s.color} strokeWidth={2} />;
    if (s.type === 'line') return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={2} />;
    if (s.type === 'highlight') return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.color} opacity={0.3} />;
    if (s.type === 'pen') return <polyline key={i} points={s.points.map((p: any) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2} />;
    if (s.type === 'text') return <text key={i} x={s.x} y={s.y} fill={s.color} fontSize={18}>{s.text}</text>;
    return null;
  }

  const tools = [
    { id: 'circle', label: '⭕' },
    { id: 'pen', label: '✏️' },
    { id: 'line', label: '📏' },
    { id: 'highlight', label: '🖍️' },
    { id: 'text', label: '📝' },
  ];

  if (stage === 'home') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', background: '#f5f5f5' }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>🎵 Sheet Music Platform</h1>
        <p style={{ color: '#666', marginBottom: 40 }}>Upload a PDF to start a session</p>
        <label style={{ padding: '14px 28px', background: '#1e1e1e', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: 16 }}>
          📄 Upload PDF
          <input type="file" accept=".pdf" onChange={handleUpload} style={{ display: 'none' }} />
        </label>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <div style={{ padding: '8px 12px', background: '#1e1e1e', display: 'flex', gap: '8px', alignItems: 'center' }}>
        {tools.map(t => (
          <button key={t.id} onClick={() => setTool(t.id as Tool)}
            style={{ padding: '6px 12px', background: tool === t.id ? '#555' : '#333', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px' }}>
            {t.label}
          </button>
        ))}
        <div style={{ width: 1, height: 28, background: '#555', margin: '0 4px' }} />
        <input type="color" value={color} onChange={e => setColor(e.target.value)}
          style={{ width: 36, height: 32, border: 'none', borderRadius: '4px', cursor: 'pointer' }} />
        <div style={{ width: 1, height: 28, background: '#555', margin: '0 4px' }} />
        <button onClick={undo} style={{ padding: '6px 12px', background: '#333', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>↩️ Undo</button>
        <button onClick={redo} style={{ padding: '6px 12px', background: '#333', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>↪️ Redo</button>
        <button onClick={clearAll} style={{ padding: '6px 12px', background: '#333', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>🗑️ Clear</button>
        <div style={{ width: 1, height: 28, background: '#555', margin: '0 4px' }} />
        <button onClick={() => setBrowseMode(m => !m)}
          style={{ padding: '6px 12px', background: browseMode ? '#2563eb' : '#333', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
          {browseMode ? '🔍 Browse' : '✏️ Annotate'}
        </button>
        <button onClick={() => navigator.clipboard.writeText(`http://localhost:3000?room=${roomId}`)}
          style={{ marginLeft: 'auto', padding: '6px 12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: 13 }}>
          🔗 Copy Share Link
        </button>
      </div>

      <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 52px)' }}>
        <iframe src={pdfUrl!} width="100%" height="100%" style={{ position: 'absolute', border: 'none' }} />
        <svg ref={svgRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: browseMode ? 'default' : 'crosshair', pointerEvents: browseMode ? 'none' : 'auto' }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
          {shapes.map((s, i) => renderShape(s, i))}
          {preview && renderShape(preview, -1)}
          {tool === 'pen' && currentPoints.length > 1 && (
            <polyline points={currentPoints.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={2} />
          )}
        </svg>
      </div>
    </div>
  );
}