'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';

export interface RowMenuItem { label: string; onClick: () => void; danger?: boolean }

// Small "⋯" menu for list rows (Recent, My Scores).
export default function RowMenu({ items }: { items: RowMenuItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="relative shrink-0" ref={ref} onClick={e => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-label={t('More actions')} title={t('More actions')}
        className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-black/[0.06]"
        style={{ color: 'var(--t3)' }}>
        <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} fill="currentColor">
          <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 rounded-xl shadow-xl py-1 text-left"
          style={{ minWidth: 200, background: 'var(--modal-bg)', border: '1px solid var(--border-md)' }}>
          {items.map(it => (
            <button key={it.label} type="button" onClick={() => { setOpen(false); it.onClick(); }}
              className="w-full text-left px-3.5 py-2 text-sm transition-colors hover:bg-black/[0.05]"
              style={{ color: it.danger ? '#ef4444' : 'var(--t)' }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
