'use client';

import { useEffect, useRef } from 'react';

interface Props {
  raisedHands: string[];
  nicknameMap: Record<string, string>;
  mySocketId: string;
  soundMuted: boolean;
  rightOffset: number;
  onMuteToggle: () => void;
  onDismiss: (socketId: string) => void;
  onDismissAll: () => void;
  onClose: () => void;
}

export default function RaisedHandsPanel({
  raisedHands, nicknameMap, mySocketId,
  soundMuted, rightOffset,
  onMuteToggle, onDismiss, onDismissAll, onClose,
}: Props) {
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
        top: 72,
        zIndex: 40,
        width: 240,
        backgroundColor: 'var(--modal-bg)',
        border: '1px solid var(--border-md)',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.32)',
        backdropFilter: 'blur(18px) saturate(1.6)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 10px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>✋</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t)' }}>
            Raised hands
            {raisedHands.length > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 500,
                color: '#fbbf24', background: 'rgba(251,191,36,0.15)',
                borderRadius: 10, padding: '1px 6px' }}>
                {raisedHands.length}
              </span>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Sound mute toggle */}
          <button
            onClick={onMuteToggle}
            title={soundMuted ? 'Unmute chime' : 'Mute chime'}
            style={{
              width: 24, height: 24, border: 'none', background: 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: soundMuted ? 'var(--t3)' : 'var(--t2)', borderRadius: 6, padding: 0,
              opacity: soundMuted ? 0.5 : 1,
            }}
          >
            {soundMuted ? <MutedIcon /> : <SoundIcon />}
          </button>
          <button
            onClick={onClose}
            style={{ width: 24, height: 24, border: 'none', background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--t3)', borderRadius: 6, padding: 0 }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {raisedHands.length > 0 && (
        <div style={{ padding: '0 10px 7px' }}>
          <button
            onClick={onDismissAll}
            style={{
              width: '100%', fontSize: 11, fontWeight: 500, padding: '4px 0', borderRadius: 7,
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--t2)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            Dismiss all
          </button>
        </div>
      )}

      <div style={{ height: 1, background: 'var(--divider)', margin: '0 10px 4px' }} />

      {raisedHands.length === 0 ? (
        <p style={{ padding: '8px 12px 12px', fontSize: 12, color: 'var(--t3)', textAlign: 'center' }}>
          No hands raised
        </p>
      ) : (
        <div style={{ maxHeight: 240, overflowY: 'auto', paddingBottom: 6 }}>
          {raisedHands.map(socketId => {
            const name = nicknameMap[socketId] || (socketId === mySocketId ? 'You' : 'Guest');
            const isMe = socketId === mySocketId;
            return (
              <div key={socketId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px' }}>
                <span style={{ fontSize: 13 }}>✋</span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--t)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                  {isMe && <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--t3)' }}>you</span>}
                </span>
                <button
                  onClick={() => onDismiss(socketId)}
                  style={{ fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 6,
                    border: '1px solid var(--border)', background: 'transparent',
                    color: 'var(--t2)', cursor: 'pointer', flexShrink: 0 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  Lower
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SoundIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}
