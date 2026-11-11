'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  defaultName: string;
  hasHiddenLayers?: boolean;
  onConfirm: (filename: string, onlyVisible: boolean) => void;
  onClose: () => void;
}

export default function ExportModal({ defaultName, hasHiddenLayers = false, onConfirm, onClose }: Props) {
  const [filename, setFilename] = useState(defaultName);
  const [onlyVisible, setOnlyVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') confirm();
    if (e.key === 'Escape') onClose();
  }

  function confirm() {
    const trimmed = filename.trim() || defaultName;
    onConfirm(trimmed.endsWith('.pdf') ? trimmed : `${trimmed}.pdf`, onlyVisible);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="unino-modal rounded-2xl w-full max-w-sm p-6 shadow-2xl" style={{ backgroundColor: 'var(--modal-bg)', border: '1px solid var(--border-md)' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
                strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-indigo-400">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-white">Export annotated PDF</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filename input */}
        <label className="block mb-1.5 text-xs font-medium text-gray-400">Filename</label>
        <input
          ref={inputRef}
          type="text"
          value={filename}
          onChange={e => setFilename(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full u-input rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
          spellCheck={false}
        />

        {/* Only visible layers checkbox — shown when some layers are hidden */}
        {hasHiddenLayers && (
          <label className="flex items-center gap-2.5 mt-3.5 cursor-pointer select-none group">
            <div
              className="relative w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors"
              style={{
                background: onlyVisible ? 'var(--accent)' : 'transparent',
                borderColor: onlyVisible ? 'var(--accent)' : 'var(--border-md)',
              }}
              onClick={() => setOnlyVisible(v => !v)}
            >
              {onlyVisible && (
                <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
                  <polyline points="2 6 5 9 10 3" />
                </svg>
              )}
            </div>
            <input type="checkbox" className="sr-only" checked={onlyVisible} onChange={e => setOnlyVisible(e.target.checked)} />
            <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">
              Only include visible layers
            </span>
          </label>
        )}

        {/* Downloads notice */}
        <div className="flex items-center gap-1.5 mt-2.5 px-0.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
            strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-gray-600 shrink-0">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <p className="text-[11px] text-gray-600">Saved to your Downloads folder · .pdf added automatically</p>
        </div>

        {/* Actions */}
        <div className="flex gap-2.5 mt-5">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-xl text-sm font-medium text-gray-400 bg-white/5 hover:bg-white/10 hover:text-white border border-white/[0.08] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            className="flex-1 h-9 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
