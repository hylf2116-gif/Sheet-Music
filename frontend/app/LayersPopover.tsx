'use client';

import { useEffect, useRef } from 'react';
import { useT } from '../lib/i18n';

export interface LayerOwner {
  ownerId: string;
  label: string;
  color: string;
  isMe: boolean;
}

interface Props {
  owners: LayerOwner[];
  hiddenOwners: Set<string>;
  rightOffset: number;
  onToggle: (ownerId: string) => void;
  onShowAll: () => void;
  onOnlyMine: () => void;
  onClose: () => void;
}

export default function LayersPopover({
  owners, hiddenOwners, rightOffset,
  onToggle, onShowAll, onOnlyMine, onClose,
}: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="phone-sheet" style={{
        position: 'fixed',
        right: rightOffset + 56,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 40,
        width: 230,
        backgroundColor: 'var(--modal-bg)',
        border: '1px solid var(--border-md)',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.32)',
        backdropFilter: 'blur(18px) saturate(1.6)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 10px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
            strokeLinecap="round" strokeLinejoin="round"
            style={{ width: 14, height: 14, color: 'var(--t2)', flexShrink: 0 }}>
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t)', letterSpacing: 0.1 }}>{t('Layers')}</span>
        </div>
        <button
          onClick={onClose}
          style={{ width: 20, height: 20, border: 'none', background: 'transparent', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)',
            borderRadius: 5, padding: 0 }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 5, padding: '0 10px 7px' }}>
        {(['Show all', 'Only mine'] as const).map(label => (
          <button
            key={label}
            onClick={label === 'Show all' ? onShowAll : onOnlyMine}
            style={{
              flex: 1, fontSize: 11, fontWeight: 500, padding: '4px 0', borderRadius: 7,
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--t2)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--t)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--t2)'; }}
          >
            {t(label)}
          </button>
        ))}
      </div>

      <div style={{ height: 1, background: 'var(--divider)', margin: '0 10px 4px' }} />

      {/* Owner rows */}
      {owners.length === 0 ? (
        <p style={{ padding: '8px 12px 12px', fontSize: 12, color: 'var(--t3)', textAlign: 'center' }}>
          {t('No annotations yet')}
        </p>
      ) : (
        <div style={{ maxHeight: 260, overflowY: 'auto', paddingBottom: 6 }}>
          {owners.map(o => {
            const hidden = hiddenOwners.has(o.ownerId);
            return (
              <div
                key={o.ownerId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                  opacity: hidden ? 0.45 : 1, transition: 'opacity 0.15s',
                }}
              >
                {/* Color dot */}
                <div style={{ width: 8, height: 8, borderRadius: 4, background: o.color, flexShrink: 0 }} />

                {/* Label */}
                <span style={{
                  flex: 1, fontSize: 13, color: 'var(--t)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {o.label}
                  {o.isMe && (
                    <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--t3)', fontWeight: 400 }}>{t('you')}</span>
                  )}
                </span>

                {/* Eye toggle */}
                <button
                  onClick={() => onToggle(o.ownerId)}
                  title={hidden ? t('Show layer') : t('Hide layer')}
                  style={{
                    width: 24, height: 24, borderRadius: 6, border: 'none',
                    background: 'transparent', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    color: hidden ? 'var(--t3)' : 'var(--t2)', padding: 0,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  {hidden ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
