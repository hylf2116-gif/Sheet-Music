'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SymbolId } from './symbols';
import { SymbolShape, makeSymbolAnnotation, isSymbolId } from './SymbolPalette';

interface Props {
  pdfUrl: string;
  annotations: any[];
  activeTool: string;
  eraserMode: 'stroke' | 'pixel';
  color: string;
  strokeWidth: number;
  // Opacity (0..1) used when the highlighter tool draws a stroke.
  highlighterOpacity?: number;
  isHost: boolean;
  mySocketId: string;
  myClientId?: string;
  remoteLasers: { socketId: string; x: number; y: number; page: number }[];
  currentPage: number;
  onPageChange: (page: number, fromScroll?: boolean) => void;
  onNumPagesLoaded: (n: number) => void;
  onAnnotationAdd: (annotation: any) => void;
  onAnnotationDelete: (id: string) => void;
  onAnnotationUpdate: (id: string, changes: any, final: boolean, prevAnnotation?: any) => void;
  hiddenOwners?: Set<string>;
  onLaserMove: (x: number, y: number, page: number) => void;
  onLaserStop: () => void;
  scrollSyncEnabled: boolean;
  remoteScrollPosition: number | null;
  onScrollPositionChange: (ratio: number) => void;
  // OMR measure overlay (all optional)
  measuresByPage?: Record<number, { n: number; x: number; y: number; w: number; h: number }[]> | null;
  showMeasureNumbers?: boolean;
  highlightedMeasure?: number | null;
  measureClickMode?: boolean;
  onMeasureClick?: (n: number) => void;
  // Music symbols: the symbol the Symbols tool stamps, its em size per page (fraction of page
  // height), the right-click / long-press menu, and leaving the tool with Esc.
  activeSymbol?: SymbolId | null;
  symbolEmForPage?: (page: number) => number;
  onSymbolPlaced?: (symbolId: SymbolId) => void;
  onSymbolMenu?: (req: { page: number; x: number; y: number; asp: number; clientX: number; clientY: number }) => void;
  onExitSymbolTool?: () => void;
  // Called when an eraser swipe starts/ends, so the whole swipe becomes one undo step.
  onEraseStart?: () => void;
  onEraseEnd?: () => void;
  // The viewer scrolled the score themselves (wheel / touch), not the app.
  onUserScroll?: () => void;
  // Scroll precisely to a measure; nonce changes on every request.
  measureJump?: { page: number; y: number; n: number; nonce: number } | null;
}

// ── Geometry helpers (pure, outside component) ────────────────────────────

const MIN_DIM = 0.005; // minimum normalized bbox dimension

type BBox = { x: number; y: number; w: number; h: number };
type DragHandle = 'body' | 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l';

interface DragInfo {
  id: string;
  pageIndex: number;
  handle: DragHandle;
  startPos: { x: number; y: number };
  prevAnnotation: any;
  origBox: BBox;
}

function isGoodNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Returns false if any numeric leaf in the geometry object is NaN, Infinity or null.
function isFiniteGeometry(obj: any): boolean {
  if (obj == null || typeof obj !== 'object') return false;
  function check(v: unknown): boolean {
    if (typeof v === 'number') return Number.isFinite(v);
    if (v === null) return false; // JSON-serialised NaN becomes null
    if (Array.isArray(v)) return v.every(item =>
      (item == null || typeof item !== 'object') || Object.values(item as object).every(check),
    );
    return true; // strings, booleans, etc. are fine
  }
  return Object.values(obj).every(check);
}

function annBBox(a: any): BBox {
  if (a.type === 'pen') {
    const xs: number[] = a.points.map((p: any) => p.x);
    const ys: number[] = a.points.map((p: any) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, w: Math.max(maxX - minX, MIN_DIM), h: Math.max(maxY - minY, MIN_DIM) };
  }
  if (a.type === 'highlight' || a.type === 'symbol') {
    // Coerce null/undefined (JSON-serialised NaN) to safe minimums
    return { x: a.x, y: a.y, w: Math.max(Number(a.w) || MIN_DIM, MIN_DIM), h: Math.max(Number(a.h) || MIN_DIM, MIN_DIM) };
  }
  if (a.type === 'ellipse') {
    // Null-safe coercions — null falls through ?? to undefined, Number(undefined)=NaN, NaN||fallback=fallback
    const cx = Number(a.cx ?? a.x) || 0.5;
    const cy = Number(a.cy ?? a.y) || 0.5;
    const rx = Math.max(Number(a.rx ?? a.r) || MIN_DIM / 2, MIN_DIM / 2);
    const ry = Math.max(Number(a.ry ?? a.r) || MIN_DIM / 2, MIN_DIM / 2);
    return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
  }
  if (a.type === 'line') {
    const x = Math.min(a.x1, a.x2), y = Math.min(a.y1, a.y2);
    return { x, y, w: Math.max(Math.abs(a.x2 - a.x1), MIN_DIM), h: Math.max(Math.abs(a.y2 - a.y1), MIN_DIM) };
  }
  if (a.type === 'text') {
    const fs = a.fontSize || 0.03;
    return { x: a.x, y: a.y - fs, w: Math.max(((a.text || '').length) * fs * 0.6, fs), h: fs * 1.5 };
  }
  return { x: 0, y: 0, w: MIN_DIM, h: MIN_DIM };
}

function annApplyMove(a: any, dx: number, dy: number): any {
  if (a.type === 'pen') return { points: a.points.map((p: any) => ({ x: p.x + dx, y: p.y + dy })) };
  // Include w,h so annClamp always receives defined values and never reads undefined as NaN.
  if (a.type === 'highlight' || a.type === 'symbol') return { x: a.x + dx, y: a.y + dy, w: a.w, h: a.h };
  if (a.type === 'ellipse') return { cx: (a.cx ?? a.x) + dx, cy: (a.cy ?? a.y) + dy };
  if (a.type === 'line') return { x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
  if (a.type === 'text') return { x: a.x + dx, y: a.y + dy };
  return {};
}

function annApplyResize(a: any, orig: BBox, next: BBox): any {
  // orig dimensions are guaranteed >= MIN_DIM by annBBox, so sx/sy are always finite.
  const sx = orig.w > 1e-9 ? next.w / orig.w : 1;
  const sy = orig.h > 1e-9 ? next.h / orig.h : 1;
  const tx = (v: number) => next.x + (v - orig.x) * sx;
  const ty = (v: number) => next.y + (v - orig.y) * sy;
  if (a.type === 'pen') return { points: a.points.map((p: any) => ({ x: tx(p.x), y: ty(p.y) })) };
  // Include w,h with floor so annClamp always has finite values.
  if (a.type === 'highlight' || a.type === 'symbol') return { x: tx(a.x), y: ty(a.y), w: Math.max((a.w || 0) * sx, 0.001), h: Math.max((a.h || 0) * sy, 0.001) };
  if (a.type === 'ellipse') {
    const cx = Number(a.cx ?? a.x) || 0, cy = Number(a.cy ?? a.y) || 0;
    const rx = Math.max(Number(a.rx ?? a.r) || 0.002, 0.002);
    const ry = Math.max(Number(a.ry ?? a.r) || 0.002, 0.002);
    return { cx: tx(cx), cy: ty(cy), rx: Math.max(rx * sx, 0.002), ry: Math.max(ry * sy, 0.002) };
  }
  if (a.type === 'line') return { x1: tx(a.x1), y1: ty(a.y1), x2: tx(a.x2), y2: ty(a.y2) };
  if (a.type === 'text') return { x: tx(a.x), y: ty(a.y), fontSize: Math.max((a.fontSize || 0.03) * sy, 0.008) };
  return {};
}

function annComputeNewBox(orig: BBox, handle: string, dx: number, dy: number, free: boolean): BBox {
  const MIN = 0.01;
  // Guard both dimensions: orig.h=0 → asp=Infinity → nw/asp=0, which is then fixed by Math.max(MIN,…)
  const asp = orig.w > 1e-9 && orig.h > 1e-9 ? orig.w / orig.h : 1;
  const { x, y, w, h } = orig;
  let nb: BBox;
  switch (handle) {
    // Corner handles: aspect-ratio locked unless Shift (free). Math.max(MIN,…) prevents zero from nw/Infinity.
    case 'br': { const nw = Math.max(MIN, w + dx); nb = { x, y, w: nw, h: free ? Math.max(MIN, h + dy) : Math.max(MIN, nw / asp) }; break; }
    case 'bl': { const nw = Math.max(MIN, w - dx); nb = { x: x + w - nw, y, w: nw, h: free ? Math.max(MIN, h + dy) : Math.max(MIN, nw / asp) }; break; }
    case 'tr': { const nw = Math.max(MIN, w + dx); const nh = free ? Math.max(MIN, h - dy) : Math.max(MIN, nw / asp); nb = { x, y: y + h - nh, w: nw, h: nh }; break; }
    case 'tl': { const nw = Math.max(MIN, w - dx); const nh = free ? Math.max(MIN, h - dy) : Math.max(MIN, nw / asp); nb = { x: x + w - nw, y: y + h - nh, w: nw, h: nh }; break; }
    case 'r':  nb = { x, y, w: Math.max(MIN, w + dx), h }; break;
    case 'l':  { const nw = Math.max(MIN, w - dx); nb = { x: x + w - nw, y, w: nw, h }; break; }
    case 'b':  nb = { x, y, w, h: Math.max(MIN, h + dy) }; break;
    case 't':  { const nh = Math.max(MIN, h - dy); nb = { x, y: y + h - nh, w, h: nh }; break; }
    default:   nb = orig;
  }
  // Final sanity: ensure no Infinity slips through (e.g. asp=0 producing nw/0=Infinity)
  return {
    x: Number.isFinite(nb.x) ? nb.x : orig.x,
    y: Number.isFinite(nb.y) ? nb.y : orig.y,
    w: Number.isFinite(nb.w) && nb.w > 0 ? nb.w : MIN,
    h: Number.isFinite(nb.h) && nb.h > 0 ? nb.h : MIN,
  };
}

function annClamp(changes: any, type: string): any {
  const c = (v: number) => Math.max(0, Math.min(1, v));
  const MIN_S = 0.001;
  if (type === 'pen') return { points: changes.points.map((p: any) => ({ x: c(p.x), y: c(p.y) })) };
  if (type === 'highlight' || type === 'symbol') {
    // changes.w / changes.h are always present (annApplyMove and annApplyResize both include them).
    // Fallback to MIN_S guards against any unexpected undefined/null.
    const x = c(changes.x ?? 0);
    const y = c(changes.y ?? 0);
    const w = Math.max(MIN_S, Math.min(changes.w ?? MIN_S, 1 - x));
    const h = Math.max(MIN_S, Math.min(changes.h ?? MIN_S, 1 - y));
    return { x, y, w, h };
  }
  if (type === 'ellipse') {
    const MIN_R = 0.002;
    return {
      ...changes,
      cx: c(changes.cx ?? 0.5),
      cy: c(changes.cy ?? 0.5),
      // Only present for resize; clamp to minimum radius.
      ...(changes.rx !== undefined ? { rx: Math.max(MIN_R, changes.rx) } : {}),
      ...(changes.ry !== undefined ? { ry: Math.max(MIN_R, changes.ry) } : {}),
    };
  }
  if (type === 'line') return { x1: c(changes.x1 ?? 0), y1: c(changes.y1 ?? 0), x2: c(changes.x2 ?? 0), y2: c(changes.y2 ?? 0) };
  if (type === 'text') return { ...changes, x: c(changes.x ?? 0), y: c(changes.y ?? 0) };
  return changes;
}

const emptySet = new Set<string>();

function handleCursor(h: string): string {
  if (h === 'tl' || h === 'br') return 'nwse-resize';
  if (h === 'tr' || h === 'bl') return 'nesw-resize';
  if (h === 't'  || h === 'b')  return 'ns-resize';
  return 'ew-resize';
}

// ── Chevrons ──────────────────────────────────────────────────────────────

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
  pdfUrl, annotations, activeTool, eraserMode, color, strokeWidth, highlighterOpacity = 0.4,
  isHost, mySocketId, myClientId, remoteLasers,
  currentPage, onPageChange, onNumPagesLoaded,
  onAnnotationAdd, onAnnotationDelete, onAnnotationUpdate,
  onLaserMove, onLaserStop,
  scrollSyncEnabled, remoteScrollPosition, onScrollPositionChange,
  hiddenOwners,
  measuresByPage, showMeasureNumbers, highlightedMeasure, measureClickMode, onMeasureClick, measureJump,
  activeSymbol, symbolEmForPage, onSymbolPlaced, onSymbolMenu, onExitSymbolTool,
  onEraseStart, onEraseEnd, onUserScroll,
}: Props) {
  // Use stable clientId for ownership checks; fall back to socketId for legacy callers.
  const myId = myClientId || mySocketId;
  // Stable empty set so callers that don't pass hiddenOwners get correct filtering.
  const hidden = hiddenOwners ?? (emptySet as Set<string>);
  const containerRef = useRef<HTMLDivElement>(null);
  // Pen and highlighter both draw freehand strokes.
  const isFreehand = activeTool === 'pen' || activeTool === 'highlight';
  const pdfDocRef = useRef<any>(null);

  const [pageMetas, setPageMetas] = useState<{ width: number; height: number }[]>([]);
  const [pageCanvases, setPageCanvases] = useState<(HTMLCanvasElement | null)[]>([]);

  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number; page: number } | null>(null);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [eraserCursor, setEraserCursor] = useState<{ x: number; y: number; page: number } | null>(null);
  // Symbols tool: ghost preview position (also where 0–4 keys stamp fingerings).
  const [symbolCursor, setSymbolCursor] = useState<{ x: number; y: number; page: number } | null>(null);
  const symbolCursorRef = useRef(symbolCursor);
  symbolCursorRef.current = symbolCursor;
  // Long-press (touch) opens the symbol menu.
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const [laserCursor, setLaserCursor] = useState<{ x: number; y: number; page: number } | null>(null);

  // ── Drag / resize state ───────────────────────────────────────────────
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [dragChanges, setDragChanges] = useState<{ id: string; changes: any } | null>(null);
  const dragInfoRef  = useRef<DragInfo | null>(null);
  const rafIdRef     = useRef<number | null>(null);
  const pendingEmitRef = useRef<{ id: string; changes: any } | null>(null);

  const pageContainerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const svgRefs = useRef<(SVGSVGElement | null)[]>([]);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const lastEraseRef = useRef<{ x: number; y: number } | null>(null);
  // Working copy of annotations during one erase gesture (see eraseList).
  const eraseWorkingRef = useRef<any[] | null>(null);
  const laserTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLaserStopRef = useRef(onLaserStop);
  const onAnnotationDeleteRef = useRef(onAnnotationDelete);
  const onAnnotationUpdateRef = useRef(onAnnotationUpdate);
  const onScrollPositionChangeRef = useRef(onScrollPositionChange);
  const scrollSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const renderedSetRef = useRef(new Set<number>());
  const renderSessionRef = useRef(0);
  const lastReportedPageRef = useRef(-1);
  const isProgrammaticScrollRef = useRef(false);
  const selfNavigatedRef = useRef(false);
  const onPageChangeRef = useRef(onPageChange);
  const pageRatiosRef = useRef<number[]>([]);
  const pageChangeDebouncerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { onLaserStopRef.current = onLaserStop; }, [onLaserStop]);
  useEffect(() => { onPageChangeRef.current = onPageChange; }, [onPageChange]);
  useEffect(() => { onAnnotationDeleteRef.current = onAnnotationDelete; }, [onAnnotationDelete]);
  useEffect(() => { onAnnotationUpdateRef.current = onAnnotationUpdate; }, [onAnnotationUpdate]);
  useEffect(() => { onScrollPositionChangeRef.current = onScrollPositionChange; }, [onScrollPositionChange]);
  useEffect(() => { dragInfoRef.current = dragInfo; }, [dragInfo]);

  // Deselect if the selected annotation's owner layer gets hidden.
  useEffect(() => {
    if (!selected) return;
    const ann = annotations.find(a => a.id === selected);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deselect when the selected shape's layer is hidden
    if (ann && hidden.has(ann.ownerId)) setSelected(null);
  }, [hidden, selected, annotations]);

  // ── Load PDF metadata ─────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    async function load() {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const doc = await pdfjsLib.getDocument({ url: pdfUrl, wasmUrl: '/' }).promise;
      if (cancelled) return;
      pdfDocRef.current = doc;
      const metas = await Promise.all(
        Array.from({ length: doc.numPages }, async (_, i) => {
          const pg = await doc.getPage(i + 1);
          const vp = pg.getViewport({ scale: 1.5 });
          return { width: vp.width, height: vp.height };
        }),
      );
      if (cancelled) return;
      renderedSetRef.current = new Set();
      setPageMetas(metas);
      setPageCanvases(new Array(doc.numPages).fill(null));
      onNumPagesLoaded(doc.numPages);
    }
    load();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  // ── Eager rendering ───────────────────────────────────────────────────
  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc || !pageMetas.length) return;
    const session = ++renderSessionRef.current;
    renderedSetRef.current = new Set();

    async function renderPage(idx: number) {
      if (renderSessionRef.current !== session) return;
      if (renderedSetRef.current.has(idx)) return;
      renderedSetRef.current.add(idx);
      try {
        const pg = await doc.getPage(idx + 1);
        if (renderSessionRef.current !== session) return;
        const vp = pg.getViewport({ scale: 1.5 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        if (renderSessionRef.current === session) {
          setPageCanvases(prev => { const n = [...prev]; n[idx] = c; return n; });
        }
      } catch { renderedSetRef.current.delete(idx); }
    }

    const eager = Math.min(3, pageMetas.length);
    for (let i = 0; i < eager; i++) renderPage(i);

    async function renderRemainder() {
      for (let i = eager; i < pageMetas.length; i++) {
        if (renderSessionRef.current !== session) break;
        await renderPage(i);
        if (renderSessionRef.current !== session) break;
        await new Promise<void>(resolve => setTimeout(resolve, 80));
      }
    }
    if (pageMetas.length > eager) renderRemainder();
    return () => { renderSessionRef.current++; };
  }, [pageMetas]);

  // ── Draw offscreen canvas to DOM canvas ───────────────────────────────
  useEffect(() => {
    pageCanvases.forEach((off, i) => {
      if (!off) return;
      const dom = canvasRefs.current[i];
      if (!dom) return;
      dom.width = off.width; dom.height = off.height;
      dom.getContext('2d')?.drawImage(off, 0, 0);
    });
  }, [pageCanvases]);

  // ── Symbols tool keys: 0–4 stamp a fingering at the cursor, Esc leaves the tool ──
  const placeSymbolRef = useRef<(id: SymbolId, page: number, pos: { x: number; y: number }) => void>(() => {});
  useEffect(() => {
    if (activeTool !== 'symbol') return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { onExitSymbolTool?.(); return; }
      const cur = symbolCursorRef.current;
      if (!cur || !/^[0-4]$/.test(e.key)) return;
      e.preventDefault();
      placeSymbolRef.current(`finger${e.key}` as SymbolId, cur.page, cur);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, onExitSymbolTool]);

  // ── Scroll to a measure (OMR "jump to bar") ───────────────────────────
  useEffect(() => {
    if (!measureJump) return;
    const container = containerRef.current;
    const svg = svgRefs.current[measureJump.page];
    if (!container || !svg) return;
    const sRect = svg.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const top = container.scrollTop + (sRect.top - cRect.top) + measureJump.y * sRect.height - 120;
    isProgrammaticScrollRef.current = true;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    // Keep the page counter in sync (fromScroll=true so it does not re-scroll to the page top).
    if (measureJump.page !== currentPage) {
      selfNavigatedRef.current = true;
      onPageChange(measureJump.page, true);
    }
    const t = setTimeout(() => { isProgrammaticScrollRef.current = false; }, 900);
    return () => clearTimeout(t);
  }, [measureJump?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll to currentPage ─────────────────────────────────────────────
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

  // ── IntersectionObserver: page sync ──────────────────────────────────
  useEffect(() => {
    if (!pageMetas.length) return;
    pageRatiosRef.current = new Array(pageMetas.length).fill(0);
    const obs = new IntersectionObserver(entries => {
      if (isProgrammaticScrollRef.current) return;
      entries.forEach(e => {
        const idx = Number(e.target.getAttribute('data-page-index'));
        if (!isNaN(idx)) pageRatiosRef.current[idx] = e.intersectionRatio;
      });
      let maxR = 0, best = lastReportedPageRef.current;
      pageRatiosRef.current.forEach((r, i) => { if (r > maxR) { maxR = r; best = i; } });
      if (maxR > 0 && best !== lastReportedPageRef.current) {
        if (pageChangeDebouncerRef.current) clearTimeout(pageChangeDebouncerRef.current);
        const captured = best;
        pageChangeDebouncerRef.current = setTimeout(() => {
          if (captured !== lastReportedPageRef.current) {
            lastReportedPageRef.current = captured;
            selfNavigatedRef.current = true;
            onPageChangeRef.current(captured, true);
          }
        }, 250);
      }
    }, { root: containerRef.current, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] });
    pageContainerRefs.current.slice(0, pageMetas.length).forEach(el => el && obs.observe(el));
    return () => { obs.disconnect(); if (pageChangeDebouncerRef.current) clearTimeout(pageChangeDebouncerRef.current); };
  }, [pageMetas]);

  // ── Keyboard: delete / deselect / nudge ──────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!selected) return;
      const ann = annotations.find(a => a.id === selected);

      if (e.key === 'Escape') { setSelected(null); return; }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        if (!ann || !canDelete(ann)) return;
        onAnnotationDeleteRef.current(selected);
        setSelected(null);
        return;
      }

      if (activeTool !== 'select' || !ann || !canDelete(ann)) return;
      const STEP = e.shiftKey ? 0.02 : 0.004;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft')  { dx = -STEP; e.preventDefault(); }
      else if (e.key === 'ArrowRight') { dx = STEP;  e.preventDefault(); }
      else if (e.key === 'ArrowUp')    { dy = -STEP; e.preventDefault(); }
      else if (e.key === 'ArrowDown')  { dy = STEP;  e.preventDefault(); }
      if (dx === 0 && dy === 0) return;

      // Clamp delta so the whole bbox stays within [0,1].
      const bb = annBBox(ann);
      const cdx = Math.max(-bb.x, Math.min(1 - bb.x - bb.w, dx));
      const cdy = Math.max(-bb.y, Math.min(1 - bb.y - bb.h, dy));
      const changes = annApplyMove(ann, cdx, cdy);
      if (!isFiniteGeometry(changes)) return;
      onAnnotationUpdateRef.current(ann.id, changes, true, ann);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, annotations, activeTool, isHost, myId]);

  // ── Manual scrolling (used to pause "follow the teacher") ───────────────
  const onUserScrollRef = useRef(onUserScroll);
  onUserScrollRef.current = onUserScroll;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // wheel / touchmove only fire for the user's own input, never for programmatic scrolls.
    const notify = () => onUserScrollRef.current?.();
    container.addEventListener('wheel', notify, { passive: true });
    container.addEventListener('touchmove', notify, { passive: true });
    return () => {
      container.removeEventListener('wheel', notify);
      container.removeEventListener('touchmove', notify);
    };
  }, [pageMetas.length]);

  // ── Scroll sync ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!scrollSyncEnabled || !isHost) return;
    const container = containerRef.current;
    if (!container) return;
    let rafId: number | null = null;
    function broadcast() {
      const max = container!.scrollHeight - container!.clientHeight;
      if (max <= 0) return;
      onScrollPositionChangeRef.current(container!.scrollTop / max);
    }
    function handleScroll() {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => { broadcast(); rafId = null; });
      }
      if (scrollSyncTimerRef.current) clearTimeout(scrollSyncTimerRef.current);
      scrollSyncTimerRef.current = setTimeout(broadcast, 100);
    }
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      if (scrollSyncTimerRef.current) clearTimeout(scrollSyncTimerRef.current);
    };
  }, [scrollSyncEnabled, isHost]);

  useEffect(() => {
    if (remoteScrollPosition === null || isHost) return;
    const container = containerRef.current;
    if (!container) return;
    isProgrammaticScrollRef.current = true;
    container.scrollTop = remoteScrollPosition * Math.max(0, container.scrollHeight - container.clientHeight);
    const t = setTimeout(() => { isProgrammaticScrollRef.current = false; }, 200);
    return () => clearTimeout(t);
  }, [remoteScrollPosition, isHost]);

  // ── Drawing helpers ───────────────────────────────────────────────────

  function getPagePos(e: { clientX: number; clientY: number }, pageIndex: number) {
    const svg = svgRefs.current[pageIndex];
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, page: pageIndex };
  }

  function getPositions(e: React.PointerEvent, pageIndex: number) {
    const svg = svgRefs.current[pageIndex];
    if (!svg) return [];
    const rect = svg.getBoundingClientRect();
    const native = e.nativeEvent;
    const raw = typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length
      ? native.getCoalescedEvents() : [native];
    return raw.map(ev => ({ x: (ev.clientX - rect.left) / rect.width, y: (ev.clientY - rect.top) / rect.height }));
  }

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

  function eraserRadius(pageWidth: number) { return (strokeWidth * 4) / pageWidth; }

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

  // Insert interpolated points so no gap between neighbours is larger than `step`
  // (straight or fast strokes can have only a few far-apart points).
  function densify(points: { x: number; y: number }[], step: number, aspect: number) {
    if (points.length < 2) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const n = Math.ceil(Math.hypot(b.x - a.x, (b.y - a.y) * aspect) / step);
      for (let k = 1; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
      out.push(b);
    }
    return out;
  }

  // Cut the part of a stroke covered by the eraser segment from→to. `reach` = eraser radius plus
  // half the stroke's width. Returns the remaining pieces, or null if the stroke was not touched.
  function splitPenStroke(
    points: { x: number; y: number }[],
    from: { x: number; y: number }, to: { x: number; y: number }, reach: number, aspect: number,
  ): { x: number; y: number }[][] | null {
    const dense = densify(points, Math.max(reach / 3, 0.0005), aspect);
    const out: { x: number; y: number }[][] = [];
    let seg: { x: number; y: number }[] = [];
    let changed = false;
    for (const p of dense) {
      if (distToSegment(p.x, p.y, from.x, from.y, to.x, to.y, aspect) <= reach) {
        changed = true;
        if (seg.length > 1) out.push(seg);
        seg = [];
      } else { seg.push(p); }
    }
    if (seg.length > 1) out.push(seg);
    return changed ? out : null;
  }

  // Half of a stroke's on-screen width, in normalized page-x units.
  function halfStroke(a: any, pageWidth: number) { return ((a.strokeWidth || 2) / 2) / pageWidth; }
  // Lines and ellipses are outlines with a thickness; other shapes are tested by their box.
  function outlineHalf(a: any, pageWidth: number) { return a.type === 'line' || a.type === 'ellipse' || a.type === 'circle' ? halfStroke(a, pageWidth) : 0; }

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
      if (!(rx > 0 && sry > 0)) return false;
      // Approximate distance to the outline: radial error scaled by the local radius.
      const nx = (x - cx) / rx, ny = (y - cy) / sry;
      const k = Math.hypot(nx, ny);
      if (k === 0) return Math.min(rx, sry * aspect) <= r;
      const ex = cx + nx / k * rx, ey = cy + ny / k * sry; // nearest-ish point on the outline
      return distToPoint(x, y, ex, ey, aspect) <= r;
    }
    if (s.type === 'line') return distToSegment(x, y, s.x1, s.y1, s.x2, s.y2, aspect) <= r;
    if (s.type === 'highlight' || s.type === 'symbol') return x >= s.x - r && x <= s.x + s.w + r && y >= s.y - ry && y <= s.y + s.h + ry;
    if (s.type === 'text') return distToPoint(x, y, s.x, s.y, aspect) <= r + (s.fontSize || 0.03) * aspect;
    return false;
  }

  function canDelete(a: any) { return isHost || a.ownerId === myId; }

  // Points along the eraser movement, so fast movements do not skip shapes in between.
  function samplePath(from: { x: number; y: number }, to: { x: number; y: number }, r: number, aspect: number) {
    const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, (to.y - from.y) * aspect) / Math.max(r / 2, 0.0005)));
    return Array.from({ length: n + 1 }, (_, k) => ({ x: from.x + ((to.x - from.x) * k) / n, y: from.y + ((to.y - from.y) * k) / n }));
  }

  // Annotations as they are during the current erase gesture. Updated immediately on every
  // delete/add, because React state only catches up on the next render and pointer events
  // arrive faster than that.
  function eraseList(): any[] {
    if (!eraseWorkingRef.current) eraseWorkingRef.current = annotations.slice();
    return eraseWorkingRef.current;
  }
  function eraseDelete(id: string) {
    eraseWorkingRef.current = eraseList().filter(a => a.id !== id);
    onAnnotationDelete(id);
  }
  function eraseAdd(ann: any) {
    eraseWorkingRef.current = [...eraseList(), ann];
    onAnnotationAdd(ann);
  }

  // Stroke eraser: delete every whole shape the eraser touches.
  function eraseSegment(pageIndex: number, from: { x: number; y: number }, to: { x: number; y: number }) {
    const meta = pageMetas[pageIndex];
    if (!meta) return;
    const r = eraserRadius(meta.width);
    const aspect = meta.height / meta.width;
    const path = samplePath(from, to, r, aspect);
    for (const a of eraseList()) {
      if (a.page !== pageIndex || hidden.has(a.ownerId) || !canDelete(a)) continue;
      const hit = a.type === 'pen'
        ? splitPenStroke(a.points ?? [], from, to, r + halfStroke(a, meta.width), aspect) !== null
        : path.some(p => shapeTouched(a, p.x, p.y, r + outlineHalf(a, meta.width), aspect));
      if (hit) eraseDelete(a.id);
    }
  }

  // Pixel eraser: cut pen/highlighter strokes and rectangle highlights; shapes that cannot be cut
  // (ellipse, line, text, symbol) are deleted whole when touched.
  function pixelEraseSegment(pageIndex: number, from: { x: number; y: number }, to: { x: number; y: number }) {
    const meta = pageMetas[pageIndex];
    if (!meta) return;
    const r = eraserRadius(meta.width);
    const aspect = meta.height / meta.width;
    const path = samplePath(from, to, r, aspect);
    for (const a of eraseList()) {
      if (a.page !== pageIndex || hidden.has(a.ownerId) || !canDelete(a)) continue;
      if (a.type === 'pen') {
        const segs = splitPenStroke(a.points ?? [], from, to, r + halfStroke(a, meta.width), aspect);
        if (segs === null) continue;
        eraseDelete(a.id);
        segs.forEach(pts => eraseAdd({
          id: crypto.randomUUID(), type: 'pen', page: pageIndex,
          points: pts, color: a.color, strokeWidth: a.strokeWidth,
          ...(a.highlighter ? { highlighter: true, opacity: a.opacity } : {}),
          ownerId: a.ownerId, _skipUndo: true,
        }));
      } else if (a.type === 'highlight') {
        const pieces = clipHighlight(a, from, to, r, aspect);
        if (pieces === null) continue;
        eraseDelete(a.id);
        pieces.forEach(piece => eraseAdd({ ...piece, id: crypto.randomUUID(), ownerId: a.ownerId, _skipUndo: true }));
      } else if (path.some(p => shapeTouched(a, p.x, p.y, r + outlineHalf(a, meta.width), aspect))) {
        eraseDelete(a.id);
      }
    }
  }

  // ── Drag / resize ─────────────────────────────────────────────────────

  function handleDragStart(e: React.PointerEvent, handle: DragHandle, ann: any, bbox: BBox, pageIndex: number) {
    e.stopPropagation();
    if (!canDelete(ann)) return;
    // Refuse to start a drag if the bbox itself is corrupt (annotation has NaN/null geometry).
    if (!isGoodNum(bbox.x) || !isGoodNum(bbox.y) || !isGoodNum(bbox.w) || !isGoodNum(bbox.h)) return;
    const pos = getPagePos(e, pageIndex);
    if (!pos) return;
    const svg = svgRefs.current[pageIndex];
    if (svg) try { svg.setPointerCapture(e.pointerId); } catch {}
    setDragInfo({
      id: ann.id,
      pageIndex,
      handle,
      startPos: { x: pos.x, y: pos.y },
      prevAnnotation: { ...ann },
      origBox: bbox,
    });
  }

  // ── Pointer handlers ──────────────────────────────────────────────────

  // Stamp a music symbol centered at pos on a page.
  function placeSymbolAt(symbolId: SymbolId, pageIndex: number, pos: { x: number; y: number }) {
    const meta = pageMetas[pageIndex];
    if (!meta) return;
    const em = symbolEmForPage ? symbolEmForPage(pageIndex) : 0.022;
    onAnnotationAdd(makeSymbolAnnotation(symbolId, pageIndex, pos.x, pos.y, em, meta.height / meta.width, color));
    onSymbolPlaced?.(symbolId);
  }

  placeSymbolRef.current = placeSymbolAt;

  function openSymbolMenu(pageIndex: number, clientX: number, clientY: number) {
    const meta = pageMetas[pageIndex];
    const pos = getPagePos({ clientX, clientY }, pageIndex);
    if (!meta || !pos || !onSymbolMenu) return;
    onSymbolMenu({ page: pageIndex, x: pos.x, y: pos.y, asp: meta.height / meta.width, clientX, clientY });
  }

  function cancelLongPress() {
    if (longPressRef.current) { clearTimeout(longPressRef.current.timer); longPressRef.current = null; }
  }

  function onPointerDown(e: React.PointerEvent, pageIndex: number) {
    if (e.button !== 0) return;
    // Touch long-press (iPad) opens the symbol menu at that spot, from any tool.
    if (e.pointerType === 'touch' && onSymbolMenu) {
      cancelLongPress();
      const { clientX, clientY } = e;
      longPressRef.current = {
        x: clientX, y: clientY,
        timer: setTimeout(() => {
          longPressRef.current = null;
          // Abandon whatever the press started drawing.
          setDrawing(false); setStart(null); setCurrentPoints([]); setPreview(null);
          openSymbolMenu(pageIndex, clientX, clientY);
        }, 550),
      };
    }
    if (activeTool === 'laser') return;
    if (activeTool === 'symbol') {
      const pos = getPagePos(e, pageIndex);
      if (pos && activeSymbol) placeSymbolAt(activeSymbol, pageIndex, pos);
      return;
    }
    if (activeTool !== 'select') {
      try { (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); } catch {}
    }

    if (activeTool === 'eraser') {
      const pos = getPagePos(e, pageIndex);
      if (!pos) return;
      setDrawing(true);
      lastEraseRef.current = pos;
      eraseWorkingRef.current = annotations.slice();
      onEraseStart?.();
      if (eraserMode === 'pixel') pixelEraseSegment(pageIndex, pos, pos);
      else eraseSegment(pageIndex, pos, pos);
      return;
    }
    if (activeTool === 'select') {
      if (e.target === e.currentTarget) setSelected(null);
      return;
    }
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
    if (isFreehand) setCurrentPoints([{ x: pos.x, y: pos.y }]);
  }

  function onPointerMove(e: React.PointerEvent, pageIndex: number) {
    // A finger that moves is drawing, not long-pressing.
    if (longPressRef.current && Math.hypot(e.clientX - longPressRef.current.x, e.clientY - longPressRef.current.y) > 8) {
      cancelLongPress();
    }
    if (activeTool === 'symbol') {
      const pos = getPagePos(e, pageIndex);
      setSymbolCursor(pos ? { x: pos.x, y: pos.y, page: pageIndex } : null);
      return;
    }
    // ── Drag / resize live update ──────────────────────────────────────
    if (dragInfo && dragInfo.pageIndex === pageIndex) {
      const pos = getPagePos(e, pageIndex);
      if (!pos) return;
      const dx = pos.x - dragInfo.startPos.x;
      const dy = pos.y - dragInfo.startPos.y;
      const ann = dragInfo.prevAnnotation;

      let changes: any;
      if (dragInfo.handle === 'body') {
        // Clamp the delta by the ORIGINAL bbox so the whole annotation stays within [0,1].
        const ob = dragInfo.origBox;
        const cdx = Math.max(-ob.x, Math.min(1 - ob.x - ob.w, dx));
        const cdy = Math.max(-ob.y, Math.min(1 - ob.y - ob.h, dy));
        changes = annApplyMove(ann, cdx, cdy);
      } else {
        const newBox = annComputeNewBox(dragInfo.origBox, dragInfo.handle, dx, dy, e.shiftKey);
        changes = annClamp(annApplyResize(ann, dragInfo.origBox, newBox), ann.type);
      }

      // Safety: reject any frame that produced NaN or Infinity (keeps previous valid geometry on screen).
      if (!isFiniteGeometry(changes)) return;

      setDragChanges({ id: dragInfo.id, changes });

      // rAF-throttled live socket emit (no state update on remote; they apply via update-shape listener)
      pendingEmitRef.current = { id: dragInfo.id, changes };
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          const di = dragInfoRef.current;
          if (di && pendingEmitRef.current) {
            onAnnotationUpdateRef.current(pendingEmitRef.current.id, pendingEmitRef.current.changes, false);
          }
          pendingEmitRef.current = null;
          rafIdRef.current = null;
        });
      }
      return;
    }

    if (activeTool === 'laser') {
      const pos = getPagePos(e, pageIndex);
      if (!pos) return;
      setLaserCursor({ x: pos.x, y: pos.y, page: pageIndex });
      onLaserMove(pos.x, pos.y, pageIndex);
      if (laserTimerRef.current) clearTimeout(laserTimerRef.current);
      laserTimerRef.current = setTimeout(() => { setLaserCursor(null); onLaserStopRef.current(); }, 1000);
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
    if (isFreehand) {
      const pts = getPositions(e, pageIndex);
      if (!pts.length) return;
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
      setPreview({ type: 'ellipse', page: pageIndex, cx: (start.x + pos.x) / 2, cy: (start.y + pos.y) / 2, rx: Math.abs(pos.x - start.x) / 2, ry: Math.abs(pos.y - start.y) / 2, color, strokeWidth });
    } else if (activeTool === 'line') {
      setPreview({ type: 'line', page: pageIndex, x1: start.x, y1: start.y, x2: pos.x, y2: pos.y, color, strokeWidth });
    }
  }

  function onPointerUp(e: React.PointerEvent, pageIndex: number) {
    cancelLongPress();
    try { (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); } catch {}

    // ── Finalize drag / resize ─────────────────────────────────────────
    if (dragInfo) {
      if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
      pendingEmitRef.current = null;
      if (dragChanges && isFiniteGeometry(dragChanges.changes)) {
        onAnnotationUpdateRef.current(dragInfo.id, dragChanges.changes, true, dragInfo.prevAnnotation);
      }
      setDragInfo(null);
      setDragChanges(null);
      return;
    }

    if (activeTool === 'eraser') {
      if (eraseWorkingRef.current) onEraseEnd?.();
      setDrawing(false); lastEraseRef.current = null; eraseWorkingRef.current = null; return;
    }
    if (!drawing || !start) return;
    if (isFreehand && currentPoints.length > 1) {
      // A highlighter stroke is a pen stroke with opacity, so move/resize/erase/sync all work unchanged.
      onAnnotationAdd({
        id: crypto.randomUUID(), type: 'pen', page: pageIndex, points: currentPoints, color, strokeWidth,
        ...(activeTool === 'highlight' ? { highlighter: true, opacity: highlighterOpacity } : {}),
      });
    } else if (preview) {
      onAnnotationAdd({ ...preview, id: crypto.randomUUID() });
    }
    setDrawing(false); setStart(null); setCurrentPoints([]); setPreview(null);
  }

  function onShapeClick(id: string) {
    if (activeTool === 'eraser') {
      if (eraserMode === 'stroke') {
        const ann = annotations.find(a => a.id === id);
        if (ann && canDelete(ann) && !hidden.has(ann.ownerId)) onAnnotationDelete(id);
      }
      return;
    }
    const ann = annotations.find(a => a.id === id);
    if (ann && canDelete(ann) && !hidden.has(ann.ownerId)) setSelected(id);
  }

  function renderAnnotation(s: any, _pageWidth: number) {
    const isSelected = selected === s.id;
    const glow = isSelected ? { filter: 'drop-shadow(0 0 4px #60a5fa)' } : {};
    const stroke = { strokeWidth: s.strokeWidth || 2, vectorEffect: 'non-scaling-stroke' as const };

    if (s.type === 'circle' || s.type === 'ellipse') {
      const cx = s.cx ?? s.x, cy = s.cy ?? s.y, rx = s.rx ?? s.r, ry = s.ry ?? s.r;
      // Guard: null/NaN geometry (from corrupted sync or legacy data) causes React SVG warnings.
      if (!isGoodNum(cx) || !isGoodNum(cy) || !isGoodNum(rx) || !isGoodNum(ry) || rx <= 0 || ry <= 0) return null;
      return <ellipse key={s.id} cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={s.color} {...stroke} style={glow} onClick={() => onShapeClick(s.id)} />;
    }
    if (s.type === 'line') {
      if (!isGoodNum(s.x1) || !isGoodNum(s.y1) || !isGoodNum(s.x2) || !isGoodNum(s.y2)) return null;
      return <line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} {...stroke} strokeLinecap="round" style={glow} onClick={() => onShapeClick(s.id)} />;
    }
    if (s.type === 'highlight') {
      if (!isGoodNum(s.w) || !isGoodNum(s.h) || s.w <= 0 || s.h <= 0) return null;
      return <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.color} opacity={0.3} style={glow} onClick={() => onShapeClick(s.id)} />;
    }
    if (s.type === 'symbol') {
      if (!isSymbolId(s.symbolId) || !isGoodNum(s.x) || !isGoodNum(s.y) || !isGoodNum(s.w) || !isGoodNum(s.h) || s.w <= 0 || s.h <= 0) return null;
      return <SymbolShape key={s.id} symbolId={s.symbolId} x={s.x} y={s.y} w={s.w} h={s.h}
        color={s.color || '#1c1c1e'} style={glow} onClick={() => onShapeClick(s.id)} />;
    }
    if (s.type === 'pen') {
      if (!s.points?.length) return null;
      // Highlighter: translucent and multiplied onto the score, so black notes stay readable underneath.
      const hl = s.highlighter ? { strokeOpacity: s.opacity ?? 0.4, mixBlendMode: 'multiply' as const } : {};
      return <path key={s.id} d={smoothPath(s.points)} fill="none" stroke={s.color} {...stroke}
        strokeOpacity={hl.strokeOpacity} strokeLinecap="round" strokeLinejoin="round"
        style={{ ...glow, mixBlendMode: hl.mixBlendMode }} onClick={() => onShapeClick(s.id)} />;
    }
    if (s.type === 'text') return <text key={s.id} x={s.x} y={s.y} fill={s.color} fontSize={s.fontSize || 0.03} style={glow} onClick={() => onShapeClick(s.id)}>{s.text}</text>;
    return null;
  }

  // Exclude the currently-dragged annotation from the memoized committed layer
  // so only the live drag layer renders it (avoids double-rendering during drag).
  const draggedId = dragChanges?.id ?? null;

  const committedLayers = useMemo(
    () => pageMetas.map((meta, i) =>
      annotations
        .filter(a => a.page === i && a.id !== draggedId && !hidden.has(a.ownerId))
        .map(a => renderAnnotation(a, meta.width)),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageMetas, annotations, selected, activeTool, eraserMode, isHost, myId, draggedId, hidden],
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
      {pageMetas.map((meta, pageIndex) => {
        const asp = meta.height / meta.width;
        // Handle radius in normalized x-axis units; ry corrects for aspect ratio.
        const HR  = 0.014;
        const HRY = HR / asp;

        // Effective annotation for the selected shape (live override during drag).
        const selAnn = selected
          ? (() => {
              const base = annotations.find(a => a.id === selected && a.page === pageIndex);
              if (!base) return null;
              if (dragChanges && dragChanges.id === selected) return { ...base, ...dragChanges.changes };
              return base;
            })()
          : null;

        const bbox = selAnn ? annBBox(selAnn) : null;
        // Only render selection handles if bbox is fully finite (guards against corrupted annotations).
        const validBbox = bbox !== null
          && isGoodNum(bbox.x) && isGoodNum(bbox.y)
          && isGoodNum(bbox.w) && isGoodNum(bbox.h)
          && bbox.w > 0 && bbox.h > 0;

        return (
          <div
            key={pageIndex}
            ref={el => { pageContainerRefs.current[pageIndex] = el; }}
            data-page-index={String(pageIndex)}
            className="flex flex-col items-center gap-2"
            style={{ width: meta.width, maxWidth: '100%' }}
          >
            <div className="text-gray-400 text-xs font-medium">Page {pageIndex + 1}</div>
            <div className="relative bg-white rounded-xl overflow-hidden ring-1 ring-black/[0.06] shadow-[0_8px_30px_rgba(0,0,0,0.10)] w-full">
              <div style={{ paddingBottom: `${(meta.height / meta.width) * 100}%` }} />

              {!pageCanvases[pageIndex] && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                  <div className="flex flex-col items-center gap-2 text-gray-300">
                    <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
                    <span className="text-xs">Page {pageIndex + 1}</span>
                  </div>
                </div>
              )}

              <canvas
                ref={el => { canvasRefs.current[pageIndex] = el; }}
                className="absolute inset-0 w-full h-full"
                style={{ display: pageCanvases[pageIndex] ? 'block' : 'none' }}
              />

              <svg
                ref={el => { svgRefs.current[pageIndex] = el; }}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full"
                style={{
                  cursor: dragInfo
                    ? (dragInfo.handle === 'body' ? 'grabbing' : handleCursor(dragInfo.handle))
                    : activeTool === 'select' ? 'default'
                    : (activeTool === 'eraser' || activeTool === 'laser' || (activeTool === 'symbol' && activeSymbol)) ? 'none'
                    : 'crosshair',
                  touchAction: activeTool === 'select' ? 'auto' : 'none',
                  userSelect: 'none',
                }}
                onPointerDown={e => onPointerDown(e, pageIndex)}
                onPointerMove={e => onPointerMove(e, pageIndex)}
                onPointerUp={e => onPointerUp(e, pageIndex)}
                onContextMenu={e => {
                  // Right-click opens the symbol menu at that spot, from any tool.
                  if (!onSymbolMenu) return;
                  e.preventDefault();
                  cancelLongPress();
                  openSymbolMenu(pageIndex, e.clientX, e.clientY);
                }}
                onPointerLeave={() => {
                  setSymbolCursor(null);
                  setEraserCursor(null);
                  if (activeTool === 'laser') {
                    setLaserCursor(null);
                    if (laserTimerRef.current) { clearTimeout(laserTimerRef.current); laserTimerRef.current = null; }
                    onLaserStopRef.current();
                  }
                }}
              >
                {/* Memoised committed layer (excludes currently-dragged annotation) */}
                {committedLayers[pageIndex]}

                {/* Live drag layer: re-renders at pointer-move rate */}
                {dragChanges && (() => {
                  const base = annotations.find(a => a.id === dragChanges.id && a.page === pageIndex);
                  if (!base || hidden.has(base.ownerId)) return null;
                  const eff = { ...base, ...dragChanges.changes };
                  return renderAnnotation(eff, meta.width);
                })()}

                {/* In-progress shape preview */}
                {preview && preview.page === pageIndex && renderAnnotation({ ...preview, id: 'preview' }, meta.width)}

                {/* Selection overlay — only shown for select tool with a valid bbox */}
                {activeTool === 'select' && selAnn && validBbox && bbox && (
                  <g>
                    {/* Dashed bounding box */}
                    <rect
                      x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h}
                      fill="none" stroke="#3b82f6" strokeWidth={1}
                      strokeDasharray="0.012 0.006"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: 'none' }}
                    />
                    {/* Body: invisible hit area for move */}
                    <rect
                      x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h}
                      fill="transparent"
                      style={{ pointerEvents: 'fill', cursor: dragInfo?.handle === 'body' ? 'grabbing' : 'move' }}
                      onPointerDown={e => handleDragStart(e, 'body', selAnn, bbox, pageIndex)}
                    />
                    {/* 8 resize handles */}
                    {([
                      { key: 'tl' as DragHandle, hx: bbox.x,                hy: bbox.y },
                      { key: 't'  as DragHandle, hx: bbox.x + bbox.w / 2,   hy: bbox.y },
                      { key: 'tr' as DragHandle, hx: bbox.x + bbox.w,       hy: bbox.y },
                      { key: 'r'  as DragHandle, hx: bbox.x + bbox.w,       hy: bbox.y + bbox.h / 2 },
                      { key: 'br' as DragHandle, hx: bbox.x + bbox.w,       hy: bbox.y + bbox.h },
                      { key: 'b'  as DragHandle, hx: bbox.x + bbox.w / 2,   hy: bbox.y + bbox.h },
                      { key: 'bl' as DragHandle, hx: bbox.x,                hy: bbox.y + bbox.h },
                      { key: 'l'  as DragHandle, hx: bbox.x,                hy: bbox.y + bbox.h / 2 },
                    ] as { key: DragHandle; hx: number; hy: number }[]).map(({ key, hx, hy }) => (
                      <ellipse
                        key={key} cx={hx} cy={hy} rx={HR} ry={HRY}
                        fill="white" stroke="#3b82f6" strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                        style={{ pointerEvents: 'fill', cursor: handleCursor(key) }}
                        onPointerDown={e => handleDragStart(e, key, selAnn, bbox, pageIndex)}
                      />
                    ))}
                  </g>
                )}

                {/* Eraser circle cursor */}
                {activeTool === 'eraser' && eraserCursor?.page === pageIndex && (
                  <ellipse
                    cx={eraserCursor.x} cy={eraserCursor.y}
                    rx={eraserRadius(meta.width)}
                    ry={eraserRadius(meta.width) / asp}
                    fill="rgba(0,0,0,0.05)" stroke="rgba(0,0,0,0.55)" strokeWidth={1}
                    vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }}
                  />
                )}

                {/* Live pen stroke */}
                {isFreehand && currentPoints.length > 1 && start?.page === pageIndex && (
                  <path d={smoothPath(currentPoints)} fill="none" stroke={color}
                    strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke"
                    strokeOpacity={activeTool === 'highlight' ? highlighterOpacity : undefined}
                    style={activeTool === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}
                    strokeLinecap="round" strokeLinejoin="round" />
                )}

                {/* OMR: shared highlighted bar, jump flash, and click targets */}
                {(() => {
                  const ms = measuresByPage?.[pageIndex];
                  if (!ms?.length) return null;
                  const hl = highlightedMeasure != null ? ms.find(m => m.n === highlightedMeasure) : null;
                  const flash = measureJump?.page === pageIndex ? ms.find(m => m.n === measureJump.n) : null;
                  return (
                    <g>
                      {hl && (
                        <rect x={hl.x} y={hl.y} width={hl.w} height={hl.h}
                          fill="rgba(245,158,11,0.18)" stroke="#f59e0b" strokeWidth={2}
                          vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
                      )}
                      {flash && (
                        <rect key={measureJump!.nonce} x={flash.x} y={flash.y} width={flash.w} height={flash.h}
                          fill="rgba(99,102,241,0.16)" stroke="#6366f1" strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                          style={{ pointerEvents: 'none', opacity: 0, animation: 'omrFlash 1.8s ease-in-out' }} />
                      )}
                      {measureClickMode && onMeasureClick && ms.map(m => (
                        <rect key={m.n} className="omr-hit" x={m.x} y={m.y} width={m.w} height={m.h}
                          fill="transparent" style={{ pointerEvents: 'fill', cursor: 'pointer' }}
                          onPointerDown={e => { e.stopPropagation(); onMeasureClick(m.n); }}>
                          <title>{`Bar ${m.n}`}</title>
                        </rect>
                      ))}
                    </g>
                  );
                })()}

                {/* Symbols tool: faded preview under the cursor */}
                {activeTool === 'symbol' && activeSymbol && symbolCursor?.page === pageIndex && (() => {
                  const g = makeSymbolAnnotation(activeSymbol, pageIndex, symbolCursor.x, symbolCursor.y,
                    symbolEmForPage ? symbolEmForPage(pageIndex) : 0.022, asp, color);
                  return <SymbolShape symbolId={activeSymbol} x={g.x} y={g.y} w={g.w} h={g.h} color={color}
                    opacity={0.4} style={{ pointerEvents: 'none' }} />;
                })()}

                {/* Laser pointers */}
                {[
                  ...remoteLasers.filter(l => l.page === pageIndex),
                  ...(activeTool === 'laser' && laserCursor?.page === pageIndex
                    ? [{ socketId: '__local__', x: laserCursor.x, y: laserCursor.y }]
                    : []),
                ].map(l => (
                  <g key={l.socketId} style={{ pointerEvents: 'none' }}>
                    <ellipse cx={l.x} cy={l.y} rx={0.018} ry={0.018 / asp} fill="rgba(255,30,30,0.22)" />
                    <ellipse cx={l.x} cy={l.y} rx={0.007} ry={0.007 / asp}
                      fill="#ff1a1a" stroke="rgba(255,255,255,0.55)" strokeWidth={0.003}
                      vectorEffect="non-scaling-stroke" />
                  </g>
                ))}
              </svg>

              {/* OMR bar numbers (HTML so text is not stretched by the SVG viewBox) */}
              {showMeasureNumbers && measuresByPage?.[pageIndex]?.map(m => (
                <div key={m.n} style={{
                  position: 'absolute', left: `${m.x * 100}%`, top: `${m.y * 100}%`,
                  transform: 'translate(2px, -100%)', pointerEvents: 'none',
                  fontSize: 10, fontWeight: 700, lineHeight: '12px', padding: '0 3px', borderRadius: 3,
                  color: '#4f46e5', background: 'rgba(255,255,255,0.85)',
                }}>
                  {m.n}
                </div>
              ))}

              {/* Delete button */}
              {(() => {
                if (!selected) return null;
                const ann = annotations.find(a => a.id === selected && a.page === pageIndex);
                if (!ann || !canDelete(ann)) return null;
                return (
                  <button
                    className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white text-xs font-medium px-2 py-1 rounded-lg shadow-lg transition-colors"
                    onClick={e => { e.stopPropagation(); onAnnotationDelete(ann.id); setSelected(null); }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                      <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    Delete
                  </button>
                );
              })()}
            </div>
          </div>
        );
      })}

      {/* Floating page-jump nav */}
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
