'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';

interface Props {
  defaultValue: string;
  dismissible?: boolean;
  onConfirm: (name: string) => void;
  onClose?: () => void;
}

export default function NicknameModal({ defaultValue, dismissible = false, onConfirm, onClose }: Props) {
  const t = useT();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = value.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 20;

  function submit() {
    if (!valid) return;
    onConfirm(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape' && dismissible) onClose?.();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={dismissible ? e => { if (e.target === e.currentTarget) onClose?.(); } : undefined}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
        style={{ backgroundColor: 'var(--modal-bg)', border: '1px solid var(--border-md)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
                strokeLinecap="round" strokeLinejoin="round"
                style={{ width: 15, height: 15, color: '#818cf8' }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--t)' }}>
              {dismissible ? t('Change your name') : t('Enter your name')}
            </h2>
          </div>
          {dismissible && onClose && (
            <button
              onClick={onClose}
              style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--t3)', borderRadius: 7 }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {!dismissible && (
          <p style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16, lineHeight: 1.5 }}>
            {t('This name is shown to everyone in the room. You can change it later.')}
          </p>
        )}

        <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--t2)', marginBottom: 6 }}>
          {t('Nickname')}
        </label>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value.slice(0, 20))}
          onKeyDown={handleKeyDown}
          maxLength={20}
          placeholder={t('Your name…')}
          className="w-full u-input rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
          spellCheck={false}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <span style={{ fontSize: 10, color: trimmed.length > 18 ? 'var(--t2)' : 'var(--t3)' }}>
            {trimmed.length}/20
          </span>
        </div>

        {trimmed.length > 0 && !valid && (
          <p style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>
            {t('Name must be 1–20 characters.')}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {dismissible && onClose && (
            <button
              onClick={onClose}
              style={{
                flex: 1, height: 36, borderRadius: 10, fontSize: 13, fontWeight: 500,
                color: 'var(--t2)', background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              }}
            >
              {t('Cancel')}
            </button>
          )}
          <button
            onClick={submit}
            disabled={!valid}
            style={{
              flex: 1, height: 36, borderRadius: 10, fontSize: 13, fontWeight: 600,
              color: 'white', background: valid ? '#6366f1' : 'rgba(99,102,241,0.4)',
              border: 'none', cursor: valid ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s',
            }}
          >
            {dismissible ? t('Save') : t('Join')}
          </button>
        </div>
      </div>
    </div>
  );
}
