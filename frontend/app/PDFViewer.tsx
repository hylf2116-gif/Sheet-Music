'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  pdfUrl: string;
  annotations: any[];
  activeTool: string;
  color: string;
  strokeWidth: number;
  onAnnotationAdd: (annotation: any) => void;
  onAnnotationUpdate: (id: string, changes: any) => void;
  onAnnotationDelete: (id: string) => void;
}

export default function PDFViewer({
  pdfUrl, annotations, activeTool, color, strokeWidth,
  onAnnotationAdd, onAnnotationUpdate, onAnnotationDelete
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<{ canvas: HTMLCanvasElement; width: number; height: number }[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number; page: number } | null>(null);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const svgRefs = useRef<(SVGSVGElement | null)[]>([]);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    if (!pdfUrl) return;
    async function loadPDF() {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise;
      const loadedPages: { canvas: HTMLCanvasElement; width: number; height: number }[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        loadedPages.push({ canvas, width: viewport.width, height: viewport.height });
      }
      setPages(loadedPages);
    }
    loadPDF();
  }, [pdfUrl]);

  useEffect(() => {
    pages.forEach((page, i) => {
      const canvas = canvasRefs.current[i];
      if (canvas) {
        canvas.width = page.canvas.width;
        canvas.height = page.canvas.height;
        canvas.getContext('2d')?.drawImage(page.canvas, 0, 0);
      }
    });
  }, [pages]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        onAnnotationDelete(selected);
        setSelected(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected]);

  function getPagePos(e: React.MouseEvent, pageIndex: number) {
    const svg = svgRefs.current[pageIndex];
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      page: pageIndex,
    };
  }

  function onMouseDown(e: React.MouseEvent, pageIndex: number) {
    if (activeTool === 'select') { setSelected(null); return; }
    if (activeTool === 'text') {
      const pos = getPagePos(e, pageIndex);
      if (!pos) return;
      const text = window.prompt('Enter text:');
      if (text) onAnnotationAdd({ id: crypto.randomUUID(), type: 'text', page: pageIndex, x: pos.x, y: pos.y, text, color, fontSize: 0.03 });
      return;
    }
    const pos = getPagePos(e, pageIndex);
    if (!pos) return;
    setDrawing(true);
    setStart(pos);
    if (activeTool === 'pen') setCurrentPoints([{ x: pos.x, y: pos.y }]);
  }

  function onMouseMove(e: React.MouseEvent, pageIndex: number) {
    if (!drawing || !start || start.page !== pageIndex) return;
    const pos = getPagePos(e, pageIndex);
    if (!pos) return;
    if (activeTool === 'pen') {
      setCurrentPoints(prev => [...prev, { x: pos.x, y: pos.y }]);
    } else if (activeTool === 'circle') {
      const r = Math.sqrt(Math.pow(pos.x - start.x, 2) + Math.pow(pos.y - start.y, 2));
      setPreview({ type: 'circle', page: pageIndex, x: start.x, y: start.y, r, color, strokeWidth });
    } else if (activeTool === 'line') {
      setPreview({ type: 'line', page: pageIndex, x1: start.x, y1: start.y, x2: pos.x, y2: pos.y, color, strokeWidth });
    } else if (activeTool === 'highlight') {
      setPreview({ type: 'highlight', page: pageIndex, x: Math.min(start.x, pos.x), y: Math.min(start.y, pos.y), w: Math.abs(pos.x - start.x), h: Math.abs(pos.y - start.y), color });
    }
  }

  function onMouseUp(e: React.MouseEvent, pageIndex: number) {
    if (!drawing || !start) return;
    if (activeTool === 'pen' && currentPoints.length > 1) {
      onAnnotationAdd({ id: crypto.randomUUID(), type: 'pen', page: pageIndex, points: currentPoints, color, strokeWidth });
    } else if (preview) {
      onAnnotationAdd({ ...preview, id: crypto.randomUUID() });
    }
    setDrawing(false); setStart(null); setCurrentPoints([]); setPreview(null);
  }

  function renderAnnotation(s: any, pageWidth: number) {
    const sw = (s.strokeWidth || 2) / pageWidth;
    const isSelected = selected === s.id;
    const glow = isSelected ? { filter: 'drop-shadow(0 0 4px #60a5fa)' } : {};

    if (s.type === 'circle') return <circle key={s.id} cx={s.x} cy={s.y} r={s.r} fill="none" stroke={s.color} strokeWidth={sw} style={glow} onClick={() => setSelected(s.id)} />;
    if (s.type === 'line') return <line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={sw} style={glow} onClick={() => setSelected(s.id)} />;
    if (s.type === 'highlight') return <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.color} opacity={0.3} style={glow} onClick={() => setSelected(s.id)} />;
    if (s.type === 'pen') return <polyline key={s.id} points={s.points.map((p: any) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={s.color} strokeWidth={sw} style={glow} onClick={() => setSelected(s.id)} />;
    if (s.type === 'text') return <text key={s.id} x={s.x} y={s.y} fill={s.color} fontSize={s.fontSize || 0.03} style={glow} onClick={() => setSelected(s.id)}>{s.text}</text>;
    return null;
  }

  if (pages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-3">🎵</div>
          <div>Loading score...</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="overflow-y-auto h-full bg-gray-800 flex flex-col items-center gap-6 py-6 px-4">
      {pages.map((page, pageIndex) => (
        <div key={pageIndex} style={{ position: 'relative', width: page.width, maxWidth: '100%' }}>
          <div className="text-center text-gray-500 text-xs mb-2">Page {pageIndex + 1}</div>
          <canvas
            ref={el => { canvasRefs.current[pageIndex] = el; }}
            style={{ display: 'block', width: '100%' }}
          />
          <svg
            ref={el => { svgRefs.current[pageIndex] = el; }}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              cursor: activeTool === 'select' ? 'default' : 'crosshair',
            }}
            onMouseDown={e => onMouseDown(e, pageIndex)}
            onMouseMove={e => onMouseMove(e, pageIndex)}
            onMouseUp={e => onMouseUp(e, pageIndex)}
          >
            {annotations.filter(a => a.page === pageIndex).map(a => renderAnnotation(a, page.width))}
            {preview && preview.page === pageIndex && renderAnnotation({ ...preview, id: 'preview' }, page.width)}
            {activeTool === 'pen' && currentPoints.length > 1 && start?.page === pageIndex && (
              <polyline points={currentPoints.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={strokeWidth / page.width} />
            )}
          </svg>
        </div>
      ))}
    </div>
  );
}