'use client';

import type { RecentSession } from '../lib/sessions';

interface Props {
  open: boolean;
  onToggle: () => void;
  sessions?: RecentSession[];
  onOpenRoom?: (roomId: string) => void;
  onShowAllSessions?: () => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Sidebar({ open, onToggle, sessions = [], onOpenRoom, onShowAllSessions }: Props) {
  return (
    <div
      className="unino-sidebar relative flex-shrink-0 flex flex-col z-10 transition-all duration-300 overflow-hidden"
      style={{ width: open ? 220 : 52, backgroundColor: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)' }}
    >
      {/* Toggle button */}
      <button
        onClick={onToggle}
        title={open ? 'Collapse sidebar' : 'Expand sidebar'}
        className="flex-shrink-0 h-12 flex items-center justify-center text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors w-full"
      >
        <svg
          width="14" height="14" viewBox="0 0 14 14" fill="none"
          className={`transition-transform duration-300 ${open ? '' : 'rotate-180'}`}
        >
          <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden py-2">

        {/* ── Recent Sessions ─────────────────────────────────────── */}
        <div className="mb-1">
          {/* Section header */}
          <div className={`flex items-center gap-3 px-3 py-2 mx-2 rounded-lg ${open ? '' : 'justify-center'}`}>
            <span className="text-sm flex-shrink-0">🕐</span>
            {open && (
              <span className="text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap text-gray-600">
                Recent Sessions
              </span>
            )}
          </div>

          {open && (
            sessions.length === 0 ? (
              <p className="text-[11px] text-gray-700 px-5 pb-2">No recent sessions yet.</p>
            ) : (
              <div className="flex flex-col gap-0.5 px-2 pb-1">
                {sessions.slice(0, 5).map(s => (
                  <button key={s.id} onClick={() => onOpenRoom?.(s.room_id)} title={s.score_name}
                    className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-xl text-left hover:bg-white/[0.05] transition-colors group">
                    <span className="text-xs flex-shrink-0 text-gray-600 group-hover:text-gray-400 transition-colors">🎼</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-gray-400 group-hover:text-gray-200 truncate transition-colors leading-tight">
                        {s.score_name}
                      </p>
                      <p className="text-[10px] text-gray-700 leading-tight mt-0.5">
                        {relativeTime(s.last_accessed)}
                      </p>
                    </div>
                  </button>
                ))}
                {onShowAllSessions && (
                  <button onClick={onShowAllSessions}
                    className="w-full text-left px-2.5 py-1.5 text-[10px] font-medium text-indigo-500 hover:text-indigo-400 transition-colors">
                    See all sessions →
                  </button>
                )}
              </div>
            )
          )}
        </div>

        {/* ── My Scores (stub) ────────────────────────────────────── */}
        <div className="mb-1">
          <div className={`flex items-center gap-3 px-3 py-2 mx-2 rounded-lg ${open ? '' : 'justify-center'}`}>
            <span className="text-sm flex-shrink-0">🎼</span>
            {open && (
              <span className="text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap text-gray-600">
                My Scores
              </span>
            )}
          </div>
          {open && <p className="text-[11px] text-gray-700 px-5 pb-2">Nothing here yet.</p>}
        </div>

        {/* ── Favorites (stub) ────────────────────────────────────── */}
        <div className="mb-1">
          <div className={`flex items-center gap-3 px-3 py-2 mx-2 rounded-lg ${open ? '' : 'justify-center'}`}>
            <span className="text-sm flex-shrink-0">⭐</span>
            {open && (
              <span className="text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap text-gray-600">
                Favorites
              </span>
            )}
          </div>
          {open && <p className="text-[11px] text-gray-700 px-5 pb-2">Nothing here yet.</p>}
        </div>

      </div>
    </div>
  );
}
