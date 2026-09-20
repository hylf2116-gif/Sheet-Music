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
  currentPage: number;
  onPageChange: (page: number) => void;
  onNumPagesLoaded: (n: number) => void;
  onAnnotationAdd: (annotation: any) => void;
  onAnnotationUpdate: (id: string, changes: any) => void;
  onAnnotationDelete: (id: string) => void;
  onLaserMove: (x: number, y: number, page: number) => void;
  onLaserStop: () => void;
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export default function PDFViewer({
  pdfUrl, annotations, activeTool, eraserMode, color, strokeWidth,
  isHost, mySocketId, remoteLasers,
  currentPage, onPageChange, onNumPagesLoaded,
  onAnnotationAdd, onAnnotationUpdate, onAnnotationDelete,
  onLaserMove, onLaserStop,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<any>(null);

  // pageMetas holds dimensions for all pages, loaded fast upfront (no rendering).
  // pageCanvases holds the rendered HTMLCanvasElement per page, filled lazily.
  const [pageMetas, setPageMetas] = useState<{ width: number; height: number }[]>([]);
  const [pageCanvases, setPageCanvases] = useState<(HTMLCanvasElement | null)[]>([]);

  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number; page: number } | null>(null);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [eraserCursor, setEraserCursor] = useState<{ x: number; y: number; page: number } | null>(null);
  const [laserCursor, setLaserCursor] = useState<{ x: number; y: number; page: number } | null>(null);

  const pageContainerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const svgRefs = useRef<(SVGSVGElement | null)[]>([]);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const lastEraseRef = useRef<{ x: number; y: number } | null>(null);
  const laserTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLaserStopRef = useRef(onLaserStop);

  // Page-sync refs (no re-render needed, just coordination).
  const renderedSetRef = useRef(new Set<number>());
  const lastReportedPageRef = useRef(-1);
  const isProgrammaticScrollRef = useRef(false);
  // Set to true when this client's own scroll triggered onPageChange, so the
  // scroll-to-page effect knows not to scroll again (user is already there).
  const selfNavigatedRef = useRef(false);
  const onPageChangeRef = useRef(onPageChange);
  const pageRatiosRef = useRef<number[]>([]);
  const pageChangeDebouncerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { onLaserStopRef.current = onLaserStop; }, [onLaserStop]);
  useEffect(() => { onPageChangeRef.current = onPageChange; }, [onPageChange]);

  // ── Load PDF metadata (fast — no pixel rendering) ──────────────────────
  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    async function load() {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      const doc = await pdfjsLib.getDocument({ url: pdfUrl }).promise;
      if (cancelled) return;
      pdfDocRef.current = doc;
      // Fetch all viewports in parallel — just reads PDF structure, no rendering.
      const metas = await Promise.all(
        Array.from({ length: doc.numPages }, async (_, i) => {
          const pg = await doc.getPage(i + 1);
          const vp = pg.getViewport({ scale: 1.5 });
          return { width: vp.width, height: vp.height };
        }),
      );
      if (cancelled) return;
      setPageMetas(metas);
      setPageCanvases(new Array(doc.numPages).fill(null));
      onNumPagesLoaded(doc.numPages);
    }
    load();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  // ── Lazy rendering: render pages only when they enter (or near) viewport ──
  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc || !pageMetas.length) return;

    async function renderPage(idx: number) {
      if (renderedSetRef.current.has(idx)) return;
      renderedSetRef.current.add(idx);
      try {
        const pg = await doc.getPage(idx + 1);
        const vp = pg.getViewport({ scale: 1.5 });
        const c = document.createElement('canvas');
        c.width = vp.width;
        c.height = vp.height;
        await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        setPageCanvases(prev => { const n = [...prev]; n[idx] = c; return n; });
      } catch {
        renderedSetRef.current.delete(idx); // allow retry
      }
    }

    // 200% rootMargin = render up to ~2 viewport-heights above/below visible area.
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const idx = Number(e.target.getAttribute('data-page-index'));
        for (let i = Math.max(0, idx - 1); i <= Math.min(pageMetas.length - 1, idx + 2); i++) {
          renderPage(i);
        }
      });
    }, { root: containerRef.current, rootMargin: '200% 0px 200% 0px' });

    pageContainerRefs.current.slice(0, pageMetas.length).forEach(el => el && obs.observe(el));
    // Eagerly kick off the first two pages so the user isn't staring at a spinner.
    renderPage(0);
    if (pageMetas.length > 1) renderPage(1);

    return () => obs.disconnect();
  }, [pageMetas.length]);

  // ── Draw each offscreen canvas to its DOM canvas once rendered ────────
  useEffect(() => {
    pageCanvases.forEach((off, i) => {
      if (!off) return;
      const dom = canvasRefs.current[i];
      if (!dom) return;
      dom.width = off.width;
      dom.height = off.height;
      dom.getContext('2d')?.drawImage(off, 0, 0);
    });
  }, [pageCanvases]);

  // ── Scroll to currentPage when the prop changes ───────────────────────
  // selfNavigated = true means this client's own scroll already moved there;
  // skip programmatic scroll so we don't jolt the user back to the page top.
  useEffect(() => {
    if (!pageMetas.length) return;
    if (selfNavigatedRef.current) { selfNavigatedRef.current = false; return; }
    const el = pageContainerRefs.current[currentPage];
    if (!el) return;
    isProgrammaticScrollRef.current = true;
    lastReportedPageRef.current = currentPage;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const t = setTimeout(() => { isProgrammaticScrollRef.current = false; }, 900);
    return () => clearTimeout(t);
  }, [currentPage, pageMetas.length]);

  // ── IntersectionObserver: track which page is most visible (page sync) ──
  useEffect(() => {
    if (!pageMetas.length) return;
    pageRatiosRef.current = new Array(pageMetas.length).fill(0);

    const obs = new IntersectionObserver(entries => {
      // Ignore observer callbacks triggered by our own programmatic scroll.
      if (isProgrammaticScrollRef.current) return;

      entries.forEach(e => {
        const idx = Number(e.target.getAttribute('data-page-index'));
        if (!isNaN(idx)) pageRatiosRef.current[idx] = e.intersectionRatio;
      });

      // Pick the page with the highest intersection ratio.
      let maxR = 0, best = lastReportedPageRef.current;
      pageRatiosRef.current.forEach((r, i) => { if (r > maxR) { maxR = r; best = i; } });

      if (maxR > 0 && best !== lastReportedPageRef.current) {
        if (pageChangeDebouncerRef.current) clearTimeout(pageChangeDebouncerRef.current);
        const captured = best;
        // Debounce 250 ms so fast manual scrolling doesn't flood the server.
        pageChangeDebouncerRef.current = setTimeout(() => {
          if (captured !== lastReportedPageRef.current) {
            lastReportedPageRef.current = captured;
            selfNavigatedRef.current = true; // tell scroll effect not to re-scroll
            onPageChangeRef.current(captured);
          }
        }, 250);
      }
    }, {
      root: containerRef.current,
      threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
    });

    pageContainerRefs.current.slice(0, pageMetas.length).forEach(el => el && obs.observe(el));
    return () => {
      obs.disconnect();
      if (pageChangeDebouncerRef.current) clearTimeout(pageChangeDebouncerRef.current);
    };
  }, [pageMetas.length]);

  // ── Keyboard: delete selected annotation ─────────────────────────────
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

  // ── Drawing helpers ───────────────────────────────────────────────────

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

  // All input samples captured since the last event — on ProMotion displays the
  // browser coalesces several points per frame, giving smoother strokes.
  function getPositions(e: React.PointerEvent, pageIndex: number) {
    const svg = svgRefs.current[pageIndex];
    if (!svg) return [];
    const rect = svg.getBoundingClientRect();
    const native = e.nativeEvent;
    const raw = typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length
      ? native.getCoalescedEvents() : [native];
    return raw.map(ev => ({
      x: (ev.clientX - rect.left) / rect.width,
      y: (ev.clientY - rect.top) / rect.height,
    }));
  }

  // Catmull-Rom spline → cubic béziers (same as Apple Notes ink).
  function smoothPath(pts: { x: number; y: number }[]) {
    if (pts.length === 0) return '';
    if (pts.length < 3) return 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ');
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
    }
    return d;
  }

  // Eraser radius as a fraction of page width, driven by the stroke-size slider.
  function eraserRadius(pageWidth: number) {
    return (strokeWidth * 4) / pageWidth;
  }

  // Distances in "screen-proportional" space: scale y by aspect ratio so the
  // eraser radius is a true circle visually (not an axis-squished ellipse).
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

  // Pixel-erase a pen stroke: remove points inside the eraser sweep, split into
  // surviving sub-segments. Returns null if nothing was hit.
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

  // Pixel-erase a highlight rect: subtract the eraser AABB, yield up to 4 pieces.
  //
  //   ┌──────────────────┐
  //   │       TOP        │
  //   ├───────┬────┬─────┤
  //   │  LEFT │////│RIGHT│
  //   ├───────┴────┴─────┤
  //   │      BOTTOM      │
  //   └──────────────────┘
  function clipHighlight(
    h: any,
    from: { x: number; y: number }, to: { x: number; y: number }, r: number, aspect: number,
  ): any[] | null {
    const ry = r / aspect;
    const ex = Math.min(from.x, to.x) - r, ey = Math.min(from.y, to.y) - ry;
    const ew = Math.abs(to.x - from.x) + 2 * r, eh = Math.abs(to.y - from.y) + 2 * ry;
    if (ex >= h.x + h.w || ex + ew <= h.x || ey >= h.y + h.h || ey + eh <= h.y) return null;
    const MIN = 0.001;
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

  function canDelete(a: any) {
    return isHost || !a.ownerId || a.ownerId === mySocketId;
  }

  // Stroke mode: any annotation the eraser sweeps over is deleted in full.
  function eraseSegment(pageIndex: number, from: { x: number; y: number }, to: { x: number; y: number }) {
    const meta = pageMetas[pageIndex];
    if (!meta) return;
    const r = eraserRadius(meta.width);
    const aspect = meta.height / meta.width;
    annotations.filter(a => a.page === pageIndex).forEach(a => {
      if (!canDelete(a)) return;
      const hit = a.type === 'pen'
        ? a.points.some((p: any) => distToSegment(p.x, p.y, from.x, from.y, to.x, to.y, aspect) <= r)
        : shapeTouched(a, to.x, to.y, r, aspect) || shapeTouched(a, from.x, from.y, r, aspect);
      if (hit) onAnnotationDelete(a.id);
    });
  }

  // Pixel mode: pen strokes are split at the eraser boundary; highlights clipped;
  // other shapes deleted on contact.
  function pixelEraseSegment(pageIndex: number, from: { x: number; y: number }, to: { x: number; y: number }) {
    const meta = pageMetas[pageIndex];
    if (!meta) return;
    const r = eraserRadius(meta.width);
    const aspect = meta.height / meta.width;
    annotations.filter(a => a.page === pageIndex).forEach(a => {
      if (!canDelete(a)) return;
      if (a.type === 'pen') {
        const segs = splitPenStroke(a.points, from, to, r, aspect);
        if (segs !== null) {
          onAnnotationDelete(a.id);
          segs.forEach(pts => onAnnotationAdd({
            id: crypto.randomUUID(), type: 'pen', page: pageIndex,
            points: pts, color: a.color, strokeWidth: a.strokeWidth,
            ownerId: a.ownerId,
          }));
        }
      } else if (a.type === 'highlight') {
        const pieces = clipHighlight(a, from, to, r, aspect);
        if (pieces !== null) {
          onAnnotationDelete(a.id);
          pieces.forEach(piece => onAnnotationAdd({ ...piece, id: crypto.randomUUID(), ownerId: a.ownerId }));
        }
      } else if (shapeTouched(a, to.x, to.y, r, aspect) || shapeTouched(a, from.x, from.y, r, aspect)) {
        onAnnotationDelete(a.id);
      }
    });
  }

  // ── Pointer handlers ──────────────────────────────────────────────────

  function onPointerDown(e: React.PointerEvent, pageIndex: number) {
    if (e.button !== 0) return;
    if (activeTool === 'laser') return;
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
      // Drop near-duplicate coalesced samples that cause blotchy overlapping ink.
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
      // Stroke mode: click deletes the whole annotation. Pixel mode: pointer-down
      // already ran pixelEraseSegment at the click position; no additional action.
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
    // non-scaling-stroke keeps pixel width uniform regardless of viewBox scale.
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
  // NOT on every pointer move — keeping in-progress strokes at 120 fps.
  const committedLayers = useMemo(
    () => pageMetas.map((meta, i) =>
      annotations.filter(a => a.page === i).map(a => renderAnnotation(a, meta.width)),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageMetas, annotations, selected, activeTool, eraserMode, isHost, mySocketId],
  );

  // ── Render ────────────────────────────────────────────────────────────

  if (pageMetas.length === 0) {
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
      {pageMetas.map((meta, pageIndex) => (
        <div
          key={pageIndex}
          ref={el => { pageContainerRefs.current[pageIndex] = el; }}
          data-page-index={String(pageIndex)}
          className="flex flex-col items-center gap-2"
          style={{ width: meta.width, maxWidth: '100%' }}
        >
          <div className="text-gray-400 text-xs font-medium">Page {pageIndex + 1}</div>
          <div
            className="relative bg-white rounded-xl overflow-hidden ring-1 ring-black/[0.06] shadow-[0_8px_30px_rgba(0,0,0,0.10)] w-full"
          >
            {/* Aspect-ratio spacer so the container has the right height before the
                canvas is rendered — prevents layout shift during lazy load. */}
            <div style={{ paddingBottom: `${(meta.height / meta.width) * 100}%` }} />

            {/* Loading placeholder shown until the offscreen canvas is ready. */}
            {!pageCanvases[pageIndex] && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                <div className="flex flex-col items-center gap-2 text-gray-300">
                  <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
                  <span className="text-xs">Page {pageIndex + 1}</span>
                </div>
              </div>
            )}

            {/* PDF canvas — absolutely positioned over the spacer div */}
            <canvas
              ref={el => { canvasRefs.current[pageIndex] = el; }}
              className="absolute inset-0 w-full h-full"
              style={{ display: pageCanvases[pageIndex] ? 'block' : 'none' }}
            />

            {/* SVG annotation overlay */}
            <svg
              ref={el => { svgRefs.current[pageIndex] = el; }}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full"
              style={{
                cursor: activeTool === 'select' ? 'default'
                  : (activeTool === 'eraser' || activeTool === 'laser') ? 'none'
                  : 'crosshair',
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
              {preview && preview.page === pageIndex && renderAnnotation({ ...preview, id: 'preview' }, meta.width)}

              {/* Eraser circle cursor — rx/ry aspect-corrected for true circle on screen */}
              {activeTool === 'eraser' && eraserCursor?.page === pageIndex && (
                <ellipse
                  cx={eraserCursor.x} cy={eraserCursor.y}
                  rx={eraserRadius(meta.width)}
                  ry={eraserRadius(meta.width) / (meta.height / meta.width)}
                  fill="rgba(0,0,0,0.05)" stroke="rgba(0,0,0,0.55)" strokeWidth={1}
                  vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }}
                />
              )}

              {/* Live pen stroke preview */}
              {activeTool === 'pen' && currentPoints.length > 1 && start?.page === pageIndex && (
                <path d={smoothPath(currentPoints)} fill="none" stroke={color}
                  strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke"
                  strokeLinecap="round" strokeLinejoin="round" />
              )}

              {/* Laser pointer dots — glow ring + bright centre, aspect-corrected */}
              {[
                ...remoteLasers.filter(l => l.page === pageIndex),
                ...(activeTool === 'laser' && laserCursor?.page === pageIndex
                  ? [{ socketId: '__local__', x: laserCursor.x, y: laserCursor.y }]
                  : []),
              ].map(l => {
                const asp = meta.height / meta.width;
                return (
                  <g key={l.socketId} style={{ pointerEvents: 'none' }}>
                    <ellipse cx={l.x} cy={l.y} rx={0.018} ry={0.018 / asp} fill="rgba(255,30,30,0.22)" />
                    <ellipse cx={l.x} cy={l.y} rx={0.007} ry={0.007 / asp}
                      fill="#ff1a1a" stroke="rgba(255,255,255,0.55)" strokeWidth={0.003}
                      vectorEffect="non-scaling-stroke" />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      ))}

      {/* Floating page-jump nav — fixed so it's always visible while scrolling */}
      {pageMetas.length > 1 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0.5 bg-gray-900/75 backdrop-blur-md text-white rounded-full px-1.5 py-1.5 shadow-2xl">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 0}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-25 transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeft />
          </button>
          <span className="text-[13px] font-medium tabular-nums px-3 select-none">
            {currentPage + 1} <span className="text-white/50">/</span> {pageMetas.length}
          </span>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= pageMetas.length - 1}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-25 transition-colors"
            aria-label="Next page"
          >
            <ChevronRight />
          </button>
        </div>
      )}
    </div>
  );
}
