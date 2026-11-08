'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  pdfUrl: string;
  currentPage: number;
  bookmarks: number[];
  onPageClick: (page: number) => void;
  onClose: () => void;
}

const TARGET_THUMB_WIDTH = 124;

export default function ThumbnailPanel({
  pdfUrl, currentPage, bookmarks, onPageClick, onClose,
}: Props) {
  const [thumbs, setThumbs] = useState<(HTMLCanvasElement | null)[]>([]);
  const [numPages, setNumPages] = useState(0);
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const activeRef = useRef<HTMLButtonElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // Load PDF and render thumbnails at small scale
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const doc = await pdfjsLib.getDocument({ url: pdfUrl }).promise;
      if (cancelled) return;
      const total = doc.numPages;
      setNumPages(total);
      setThumbs(new Array(total).fill(null));
      for (let i = 0; i < total; i++) {
        if (cancelled) break;
        try {
          const pg = await doc.getPage(i + 1) as any;
          const vp1 = pg.getViewport({ scale: 1 });
          const scale = TARGET_THUMB_WIDTH / vp1.width;
          const vp = pg.getViewport({ scale });
          const c = document.createElement('canvas');
          c.width = Math.round(vp.width);
          c.height = Math.round(vp.height);
          await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
          if (!cancelled) {
            setThumbs(prev => { const a = [...prev]; a[i] = c; return a; });
          }
          // Yield to browser between pages
          await new Promise<void>(r => setTimeout(r, 40));
        } catch { /* skip failed page */ }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  // Redraw when thumbs arrive OR when filter toggles (canvas elements remount)
  useEffect(() => {
    thumbs.forEach((off, i) => {
      if (!off) return;
      const el = canvasRefs.current[i];
      if (!el) return;
      if (el.width !== off.width) el.width = off.width;
      if (el.height !== off.height) el.height = off.height;
      el.getContext('2d')?.drawImage(off, 0, 0);
    });
  }, [thumbs, showBookmarksOnly]);

  // Scroll active thumbnail into view when page changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentPage]);

  const allPages = Array.from({ length: numPages }, (_, i) => i);
  const visiblePages = showBookmarksOnly
    ? allPages.filter(i => bookmarks.includes(i))
    : allPages;

  return (
    <div
      className="unino-panel flex flex-col shrink-0"
      style={{
        width: 160,
        height: '100%',
        background: 'var(--panel-bg)',
        borderRight: '1px solid var(--panel-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between shrink-0 px-3"
        style={{ height: 48, borderBottom: '1px solid var(--divider)' }}
      >
        <div className="flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
            strokeLinecap="round" strokeLinejoin="round"
            style={{ width: 14, height: 14, color: '#818cf8', flexShrink: 0 }}>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span className="text-[13px] font-semibold text-gray-200">Pages</span>
          {numPages > 0 && (
            <span className="text-[10px] text-gray-600">{numPages}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Bookmark filter pill — only shown when there are bookmarks */}
      {bookmarks.length > 0 && (
        <div className="shrink-0 px-2 pt-2">
          <button
            onClick={() => setShowBookmarksOnly(v => !v)}
            className={`w-full flex items-center justify-center gap-1.5 h-7 rounded-lg text-[11px] font-medium transition-colors ${
              showBookmarksOnly
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-gray-300'
            }`}
          >
            <svg viewBox="0 0 24 24"
              fill={showBookmarksOnly ? 'currentColor' : 'none'}
              stroke="currentColor" strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round"
              style={{ width: 10, height: 10 }}>
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            </svg>
            {showBookmarksOnly ? 'All pages' : `Bookmarks (${bookmarks.length})`}
          </button>
        </div>
      )}

      {/* Thumbnail list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-2">
        {visiblePages.length === 0 && showBookmarksOnly && (
          <p className="text-[11px] text-gray-600 text-center pt-6">No bookmarks yet</p>
        )}

        {visiblePages.map(i => {
          const isActive = i === currentPage;
          const isBookmarked = bookmarks.includes(i);

          return (
            <button
              key={i}
              ref={isActive ? activeRef : undefined}
              onClick={() => onPageClick(i)}
              className={`w-full rounded-lg overflow-hidden transition-all outline-none focus-visible:outline-none ${
                isActive
                  ? 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-transparent'
                  : 'ring-1 ring-white/[0.07] hover:ring-white/25'
              }`}
            >
              {/* Page image */}
              <div className="relative w-full bg-white">
                {thumbs[i] ? (
                  <canvas
                    ref={el => {
                      canvasRefs.current[i] = el;
                      // Draw immediately on mount if thumb is already available
                      if (el && thumbs[i]) {
                        const off = thumbs[i]!;
                        if (el.width !== off.width) el.width = off.width;
                        if (el.height !== off.height) el.height = off.height;
                        el.getContext('2d')?.drawImage(off, 0, 0);
                      }
                    }}
                    className="w-full block"
                  />
                ) : (
                  <div className="relative w-full bg-gray-100" style={{ paddingBottom: '141.4%' }}>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-4 h-4 rounded-full border-2 border-gray-200 border-t-gray-400 animate-spin" />
                    </div>
                  </div>
                )}

                {/* Bookmark indicator */}
                {isBookmarked && (
                  <div className="absolute top-1 right-1 pointer-events-none">
                    <svg viewBox="0 0 24 24" fill="#f59e0b" stroke="none"
                      style={{ width: 10, height: 10 }}>
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Page label */}
              <div
                className="px-1.5 py-0.5"
                style={{ fontSize: 10, fontWeight: 500, color: isActive ? '#818cf8' : 'var(--t4)' }}
              >
                {i + 1}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
