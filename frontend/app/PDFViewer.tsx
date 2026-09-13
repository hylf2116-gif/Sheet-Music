'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  pdfUrl: string;
  annotations: any[];
  activeTool: string;
  eraserMode: 'stroke' | 'pixel';
  color: string;
  strokeWidth: number;
  isHost: boolean;
  mySocketId: string;
  remoteLasers: { socketId: string; x: number; y: number; page: number }[];
  onAnnotationAdd: (annotation: any) => void;
  onAnnotationUpdate: (id: string, changes: any) => void;
  onAnnotationDelete: (id: string) => void;
  onLaserMove: (x: number, y: number, page: number) => void;
  onLaserStop: () => void;
}

export default function PDFViewer({
  pdfUrl, annotations, activeTool, eraserMode, color, strokeWidth,
  isHost, mySocketId, remoteLasers,
  onAnnotationAdd, onAnnotationUpdate, onAnnotationDelete,
  onLaserMove, onLaserStop,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<{ canvas: HTMLCanvasElement; width: number; height: number }[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number; page: number } | null>(null);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [eraserCursor, setEraserCursor] = useState<{ x: number; y: number; page: number } | null>(null);
  const [laserCursor, setLaserCursor] = useState<{ x: number; y: number; page: number } | null>(null);
  const svgRefs = useRef<(SVGSVGElement | null)[]>([]);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const lastEraseRef = useRef<{ x: number; y: number } | null>(null);
  const laserTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLaserStopRef = useRef(onLaserStop);
  useEffect(() => { onLaserStopRef.current = onLaserStop; }, [onLaserStop]);

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
        const ann = annotations.find(a => a.id === selected);
        if (!ann || !(isHost || !ann.ownerId || ann.ownerId === mySocketId)) return;
        onAnnotationDelete(selected);
        setSelected(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, annotations, isHost, mySocketId]);

  function getPagePos(e: { clientX: number; clientY: number }, pageIndex: number) {
    const svg = svgRefs.current[pageIndex];
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      page: pageIndex,
    };
  }

  // All input samples captured since the last event — on high-refresh (ProMotion)
  // displays the browser coalesces several points per frame, giving far smoother
  // strokes than a single per-event position.
  function getPositions(e: React.PointerEvent, pageIndex: number) {
    const svg = svgRefs.current[pageIndex];
    if (!svg) return [];
    const rect = svg.getBoundingClientRect();
    const native = e.nativeEvent;
    const raw = typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length
      ? native.getCoalescedEvents()
      : [native];
    return raw.map(ev => ({
      x: (ev.clientX - rect.left) / rect.width,
      y: (ev.clientY - rect.top) / rect.height,
    }));
  }

  // Catmull-Rom spline through the points, emitted as cubic béziers — the same
  // interpolation that gives Apple Notes its flowing, non-jagged ink.
  function smoothPath(pts: { x: number; y: number }[]) {
    if (pts.length === 0) return '';
    if (pts.length < 3) return 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ');
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
    }
    return d;
  }

  // Eraser radius, expressed as a fraction of page WIDTH, scaled by the size slider.
  function eraserRadius(pageWidth: number) {
    return (strokeWidth * 4) / pageWidth;
  }

  // Distances are measured in "screen-proportional" space: because coordinates are
  // normalized 0-1 on a page that isn't square, we scale y by the aspect ratio so a
  // radius reads the same horizontally and vertically (i.e. a true circle on screen).
  function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number, aspect = 1) {
    const Py = py * aspect, Ay = ay * aspect, By = by * aspect;
    const dx = bx - ax, dy = By - Ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (Py - Ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), Py - (Ay + t * dy));
  }

  function distToPoint(px: number, py: number, ax: number, ay: number, aspect = 1) {
    return Math.hypot(px - ax, (py - ay) * aspect);
  }

  // Split a pen stroke around the eraser sweep from→to. Returns the surviving
  // sub-arrays (may be empty if the whole stroke is erased), or null if untouched.
  function splitPenStroke(
    points: { x: number; y: number }[],
    from: { x: number; y: number }, to: { x: number; y: number }, r: number, aspect: number,
  ): { x: number; y: number }[][] | null {
    const out: { x: number; y: number }[][] = [];
    let seg: { x: number; y: number }[] = [];
    let changed = false;
    for (const p of points) {
      if (distToSegment(p.x, p.y, from.x, from.y, to.x, to.y, aspect) <= r) {
        changed = true;
        if (seg.length > 1) out.push(seg);
        seg = [];
      } else {
        seg.push(p);
      }
    }
    if (seg.length > 1) out.push(seg);
    return changed ? out : null;
  }

  // Subtract the eraser's swept AABB from a highlight rect, producing up to four
  // surviving rectangular pieces. Returns null when there is no intersection.
  //
  //   ┌──────────────────┐
  //   │       TOP        │  above erase box
  //   ├───────┬────┬─────┤
  //   │  LEFT │////│RIGHT│  middle band (y overlaps erase box)
  //   ├───────┴────┴─────┤
  //   │      BOTTOM      │  below erase box
  //   └──────────────────┘
  function clipHighlight(
    h: any,
    from: { x: number; y: number }, to: { x: number; y: number }, r: number, aspect: number,
  ): any[] | null {
    // Convert radius to normalized coords. x-radius = r (fraction of width);
    // y-radius = r/aspect because normalized y is a fraction of height, not width.
    const ry = r / aspect;
    const ex = Math.min(from.x, to.x) - r,  ey = Math.min(from.y, to.y) - ry;
    const ew = Math.abs(to.x - from.x) + 2 * r, eh = Math.abs(to.y - from.y) + 2 * ry;

    if (ex >= h.x + h.w || ex + ew <= h.x || ey >= h.y + h.h || ey + eh <= h.y) return null;

    const MIN = 0.001; // discard slivers thinner than this
    const pieces: any[] = [];

    const topH = ey - h.y;
    if (topH > MIN) pieces.push({ ...h, y: h.y, h: topH });

    const botY = ey + eh, botH = h.y + h.h - botY;
    if (botH > MIN) pieces.push({ ...h, y: botY, h: botH });

    const midY = Math.max(h.y, ey), midH = Math.min(h.y + h.h, ey + eh) - midY;
    const leftW = ex - h.x;
    if (leftW > MIN && midH > MIN) pieces.push({ ...h, x: h.x, y: midY, w: leftW, h: midH });

    const rightX = ex + ew, rightW = h.x + h.w - rightX;
    if (rightW > MIN && midH > MIN) pieces.push({ ...h, x: rightX, y: midY, w: rightW, h: midH });

    return pieces;
  }

  function shapeTouched(s: any, x: number, y: number, r: number, aspect: number) {
    const ry = r / aspect;
    if (s.type === 'circle' || s.type === 'ellipse') {
      const cx = s.cx ?? s.x, cy = s.cy ?? s.y, rx = s.rx ?? s.r, sry = s.ry ?? s.r;
      return Math.abs(x - cx) <= rx + r && Math.abs(y - cy) <= sry + ry;
    }
    if (s.type === 'line') return distToSegment(x, y, s.x1, s.y1, s.x2, s.y2, aspect) <= r;
    if (s.type === 'highlight') return x >= s.x - r && x <= s.x + s.w + r && y >= s.y - ry && y <= s.y + s.h + ry;
    if (s.type === 'text') return distToPoint(x, y, s.x, s.y, aspect) <= r + (s.fontSize || 0.03) * aspect;
    return false;
  }

  function canDelete(a: any): boolean {
    return isHost || !a.ownerId || a.ownerId === mySocketId;
  }

  // Stroke mode: any annotation the eraser touches is deleted in full.
  function eraseSegment(pageIndex: number, from: { x: number; y: number }, to: { x: number; y: number }) {
    const page = pages[pageIndex];
    if (!page) return;
    const r = eraserRadius(page.width);
    const aspect = page.height / page.width;
    annotations.filter(a => a.page === pageIndex).forEach(a => {
      if (!canDelete(a)) return;
      const hit = a.type === 'pen'
        ? a.points.some((p: any) => distToSegment(p.x, p.y, from.x, from.y, to.x, to.y, aspect) <= r)
        : shapeTouched(a, to.x, to.y, r, aspect) || shapeTouched(a, from.x, from.y, r, aspect);
      if (hit) onAnnotationDelete(a.id);
    });
  }

  // Pixel mode: pen strokes are split, highlights are clipped, other shapes deleted on contact.
  function pixelEraseSegment(pageIndex: number, from: { x: number; y: number }, to: { x: number; y: number }) {
    const page = pages[pageIndex];
    if (!page) return;
    const r = eraserRadius(page.width);
    const aspect = page.height / page.width;
    annotations.filter(a => a.page === pageIndex).forEach(a => {
      if (!canDelete(a)) return;
      if (a.type === 'pen') {
        const segs = splitPenStroke(a.points, from, to, r, aspect);
        if (segs !== null) {
          onAnnotationDelete(a.id);
          segs.forEach(pts => onAnnotationAdd({
            id: crypto.randomUUID(), type: 'pen', page: pageIndex,
            points: pts, color: a.color, strokeWidth: a.strokeWidth,
          }));
        }
      } else if (a.type === 'highlight') {
        const pieces = clipHighlight(a, from, to, r, aspect);
        if (pieces !== null) {
          onAnnotationDelete(a.id);
          pieces.forEach(piece => onAnnotationAdd({ ...piece, id: crypto.randomUUID() }));
        }
      } else if (shapeTouched(a, to.x, to.y, r, aspect) || shapeTouched(a, from.x, from.y, r, aspect)) {
        onAnnotationDelete(a.id);
      }
    });
  }

  function onPointerDown(e: React.PointerEvent, pageIndex: number) {
    if (e.button !== 0) return; // primary button / touch / pen only
    if (activeTool === 'laser') return; // laser is hover-only, no pointer capture
    // Keep receiving move/up events even if the pointer slips outside the page.
    try { (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); } catch {}

    if (activeTool === 'eraser') {
      const pos = getPagePos(e, pageIndex);
      if (!pos) return;
      setDrawing(true);
      lastEraseRef.current = pos;
      if (eraserMode === 'pixel') pixelEraseSegment(pageIndex, pos, pos);
      else eraseSegment(pageIndex, pos, pos);
      return;
    }
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

  function onPointerMove(e: React.PointerEvent, pageIndex: number) {
    if (activeTool === 'laser') {
      const pos = getPagePos(e, pageIndex);
      if (!pos) return;
      setLaserCursor({ x: pos.x, y: pos.y, page: pageIndex });
      onLaserMove(pos.x, pos.y, pageIndex);
      if (laserTimerRef.current) clearTimeout(laserTimerRef.current);
      laserTimerRef.current = setTimeout(() => {
        setLaserCursor(null);
        onLaserStopRef.current();
      }, 1000);
      return;
    }
    if (activeTool === 'eraser') {
      const pos = getPagePos(e, pageIndex);
      if (!pos) return;
      setEraserCursor({ x: pos.x, y: pos.y, page: pageIndex });
      if (drawing) {
        let last = lastEraseRef.current || pos;
        for (const p of getPositions(e, pageIndex)) {
          if (eraserMode === 'pixel') pixelEraseSegment(pageIndex, last, p);
          else eraseSegment(pageIndex, last, p);
          last = p;
        }
        lastEraseRef.current = last;
      }
      return;
    }
    if (!drawing || !start || start.page !== pageIndex) return;
    if (activeTool === 'pen') {
      const pts = getPositions(e, pageIndex);
      if (!pts.length) return;
      // Drop samples that are too close to the previous point. Dense clusters of
      // near-duplicate coalesced points are what produce the overlapping/blotchy
      // look; thinning keeps the Catmull-Rom curve clean and even.
      const MIN_DIST = 0.0015;
      setCurrentPoints(prev => {
        const out = prev.slice();
        for (const p of pts) {
          const last = out[out.length - 1];
          if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_DIST) out.push(p);
        }
        return out;
      });
      return;
    }
    const pos = getPagePos(e, pageIndex);
    if (!pos) return;
    if (activeTool === 'ellipse') {
      setPreview({
        type: 'ellipse', page: pageIndex,
        cx: (start.x + pos.x) / 2, cy: (start.y + pos.y) / 2,
        rx: Math.abs(pos.x - start.x) / 2, ry: Math.abs(pos.y - start.y) / 2,
        color, strokeWidth,
      });
    } else if (activeTool === 'line') {
      setPreview({ type: 'line', page: pageIndex, x1: start.x, y1: start.y, x2: pos.x, y2: pos.y, color, strokeWidth });
    } else if (activeTool === 'highlight') {
      setPreview({ type: 'highlight', page: pageIndex, x: Math.min(start.x, pos.x), y: Math.min(start.y, pos.y), w: Math.abs(pos.x - start.x), h: Math.abs(pos.y - start.y), color });
    }
  }

  function onPointerUp(e: React.PointerEvent, pageIndex: number) {
    try { (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); } catch {}
    if (activeTool === 'eraser') { setDrawing(false); lastEraseRef.current = null; return; }
    if (!drawing || !start) return;
    if (activeTool === 'pen' && currentPoints.length > 1) {
      onAnnotationAdd({ id: crypto.randomUUID(), type: 'pen', page: pageIndex, points: currentPoints, color, strokeWidth });
    } else if (preview) {
      onAnnotationAdd({ ...preview, id: crypto.randomUUID() });
    }
    setDrawing(false); setStart(null); setCurrentPoints([]); setPreview(null);
  }

  function onShapeClick(id: string) {
    if (activeTool === 'eraser') {
      // Stroke mode: click-to-delete entire annotation. Pixel mode: pointer-down
      // already ran pixelEraseSegment at the click position; don't also whole-delete.
      if (eraserMode === 'stroke') {
        const ann = annotations.find(a => a.id === id);
        if (ann && canDelete(ann)) onAnnotationDelete(id);
      }
      return;
    }
    setSelected(id);
  }

  function renderAnnotation(s: any, _pageWidth: number) {
    const isSelected = selected === s.id;
    const glow = isSelected ? { filter: 'drop-shadow(0 0 4px #60a5fa)' } : {};
    // non-scaling-stroke keeps the width uniform in screen pixels, immune to the
    // non-uniform viewBox scaling — no more thick-on-one-axis strokes.
    const stroke = { strokeWidth: s.strokeWidth || 2, vectorEffect: 'non-scaling-stroke' as const };

    if (s.type === 'circle' || s.type === 'ellipse') {
      const cx = s.cx ?? s.x, cy = s.cy ?? s.y, rx = s.rx ?? s.r, ry = s.ry ?? s.r;
      return <ellipse key={s.id} cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={s.color} {...stroke} style={glow} onClick={() => onShapeClick(s.id)} />;
    }
    if (s.type === 'line') return <line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} {...stroke} strokeLinecap="round" style={glow} onClick={() => onShapeClick(s.id)} />;
    if (s.type === 'highlight') return <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.color} opacity={0.3} style={glow} onClick={() => onShapeClick(s.id)} />;
    if (s.type === 'pen') return <path key={s.id} d={smoothPath(s.points)} fill="none" stroke={s.color} {...stroke} strokeLinecap="round" strokeLinejoin="round" style={glow} onClick={() => onShapeClick(s.id)} />;
    if (s.type === 'text') return <text key={s.id} x={s.x} y={s.y} fill={s.color} fontSize={s.fontSize || 0.03} style={glow} onClick={() => onShapeClick(s.id)}>{s.text}</text>;
    return null;
  }

  // Committed annotations only re-render when they (or selection/tool) change —
  // NOT on every pointer move — so an in-progress stroke stays buttery at 120fps
  // even over a page that already has hundreds of marks.
  const committedLayers = useMemo(
    () => pages.map((page, i) =>
      annotations.filter(a => a.page === i).map(a => renderAnnotation(a, page.width))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, annotations, selected, activeTool, eraserMode, isHost, mySocketId],
  );

  if (pages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-[#f5f5f7] text-gray-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
          <div className="text-sm">Loading score…</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="overflow-y-auto h-full bg-[#f5f5f7] flex flex-col items-center gap-8 py-8 px-4">
      {pages.map((page, pageIndex) => (
        <div key={pageIndex} className="flex flex-col items-center gap-2" style={{ width: page.width, maxWidth: '100%' }}>
          <div className="text-gray-400 text-xs font-medium">Page {pageIndex + 1}</div>
          <div
            className="relative bg-white rounded-xl overflow-hidden ring-1 ring-black/[0.06] shadow-[0_8px_30px_rgba(0,0,0,0.10)]"
            style={{ width: '100%' }}
          >
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
              cursor: activeTool === 'select' ? 'default'
                : (activeTool === 'eraser' || activeTool === 'laser') ? 'none'
                : 'crosshair',
              // Let the page scroll normally with the select tool; capture the
              // gesture for drawing/erasing so touch strokes don't pan the view.
              touchAction: activeTool === 'select' ? 'auto' : 'none',
              userSelect: 'none',
            }}
            onPointerDown={e => onPointerDown(e, pageIndex)}
            onPointerMove={e => onPointerMove(e, pageIndex)}
            onPointerUp={e => onPointerUp(e, pageIndex)}
            onPointerLeave={() => {
              setEraserCursor(null);
              if (activeTool === 'laser') {
                setLaserCursor(null);
                if (laserTimerRef.current) { clearTimeout(laserTimerRef.current); laserTimerRef.current = null; }
                onLaserStopRef.current();
              }
            }}
          >
            {committedLayers[pageIndex]}
            {preview && preview.page === pageIndex && renderAnnotation({ ...preview, id: 'preview' }, page.width)}
            {activeTool === 'eraser' && eraserCursor && eraserCursor.page === pageIndex && (
              // rx/ry compensate for the non-square viewBox so it draws as a true circle.
              <ellipse
                cx={eraserCursor.x}
                cy={eraserCursor.y}
                rx={eraserRadius(page.width)}
                ry={eraserRadius(page.width) / (page.height / page.width)}
                fill="rgba(0,0,0,0.05)"
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
            )}
            {activeTool === 'pen' && currentPoints.length > 1 && start?.page === pageIndex && (
              <path d={smoothPath(currentPoints)} fill="none" stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            )}
            {/* Laser pointer dots — glow ring + bright center, aspect-corrected */}
            {[
              ...remoteLasers.filter(l => l.page === pageIndex),
              ...(activeTool === 'laser' && laserCursor?.page === pageIndex
                ? [{ socketId: '__local__', x: laserCursor.x, y: laserCursor.y }]
                : []),
            ].map(l => {
              const asp = page.height / page.width;
              return (
                <g key={l.socketId} style={{ pointerEvents: 'none' }}>
                  <ellipse cx={l.x} cy={l.y} rx={0.018} ry={0.018 / asp} fill="rgba(255,30,30,0.22)" />
                  <ellipse cx={l.x} cy={l.y} rx={0.007} ry={0.007 / asp}
                    fill="#ff1a1a" stroke="rgba(255,255,255,0.55)" strokeWidth={0.003} vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </svg>
          </div>
        </div>
      ))}
    </div>
  );
}