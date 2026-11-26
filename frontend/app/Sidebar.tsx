'use client';

import { useMemo } from 'react';
import Glyph from './Glyph';
import type { LibraryRoom } from '../lib/library';
import { useT } from '../lib/i18n';

// Home sidebar: a teacher's workspace. It does not repeat the Recent list from the page;
// it gives quick ways in: start a lesson, pinned scores, and scores per student.
interface Props {
  open: boolean;
  onToggle: () => void;
  myRooms: LibraryRoom[];
  pinned: string[];                       // roomIds pinned by this person
  onOpenRoom: (roomId: string) => void;
  onNewSession: () => void;               // opens the PDF picker
  onShowLibrary: (student?: string) => void; // '' = scores without a student
  uploading?: boolean;
}

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];
function avatarColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pt-5 pb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--t3)' }}>{children}</span>
      {action}
    </div>
  );
}

export default function Sidebar({ open, onToggle, myRooms, pinned, onOpenRoom, onNewSession, onShowLibrary, uploading }: Props) {
  const t = useT();

  const pinnedRooms = useMemo(
    () => pinned.map(id => myRooms.find(r => r.roomId === id)).filter((r): r is LibraryRoom => !!r),
    [pinned, myRooms],
  );
  const students = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of myRooms) if (r.studentTag) map.set(r.studentTag, (map.get(r.studentTag) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [myRooms]);
  const unassigned = myRooms.filter(r => !r.studentTag).length;

  const row = 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-[var(--surface)]';

  // Collapsed: a slim rail of icons
  if (!open) {
    return (
      <nav className="unino-sidebar relative flex-shrink-0 flex flex-col items-center gap-1 py-3 z-10"
        style={{ width: 56, backgroundColor: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)' }}>
        <button onClick={onToggle} title={t('Expand sidebar')} aria-label={t('Expand sidebar')}
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--surface)]" style={{ color: 'var(--t3)' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button onClick={onNewSession} disabled={uploading} title={t('New lesson')} aria-label={t('New lesson')}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 mt-1">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button onClick={() => onShowLibrary()} title={t('My Scores')} aria-label={t('My Scores')}
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--surface)] mt-2" style={{ color: 'var(--t2)' }}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z" /><path d="M8 7h6" /></svg>
        </button>
        {students.slice(0, 6).map(([name]) => (
          <button key={name} onClick={() => onShowLibrary(name)} title={name} aria-label={name}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
            style={{ background: avatarColor(name) }}>
            {name.trim()[0]?.toUpperCase()}
          </button>
        ))}
      </nav>
    );
  }

  return (
    <nav className="unino-sidebar relative flex-shrink-0 flex flex-col z-10"
      style={{ width: 240, backgroundColor: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)' }}>
      <div className="flex items-center justify-between px-3 pt-3">
        <span className="text-xs font-semibold px-1.5" style={{ color: 'var(--t2)' }}>{t('Teaching')}</span>
        <button onClick={onToggle} title={t('Collapse sidebar')} aria-label={t('Collapse sidebar')}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--surface)]" style={{ color: 'var(--t3)' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <div className="px-3 pt-3">
        <button onClick={onNewSession} disabled={uploading}
          className="w-full flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors shadow-sm">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          {uploading ? t('Uploading…') : t('New lesson')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {/* Pinned */}
        <SectionTitle>{t('Pinned')}</SectionTitle>
        {pinnedRooms.length === 0 ? (
          <p className="px-2.5 pb-1 text-[11.5px] leading-snug" style={{ color: 'var(--t3)' }}>
            {t('Pin the scores you use every week. Tap the star in My Scores.')}
          </p>
        ) : pinnedRooms.map(r => (
          <button key={r.roomId} onClick={() => onOpenRoom(r.roomId)} className={row} title={r.scoreName}>
            <span className="text-amber-500 shrink-0"><Glyph name="starFill" size={14} /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium truncate" style={{ color: 'var(--t)' }}>{r.scoreName}</span>
              {r.studentTag && <span className="block text-[11px] truncate" style={{ color: 'var(--t3)' }}>{r.studentTag}</span>}
            </span>
          </button>
        ))}

        {/* Students */}
        <SectionTitle>{t('Students')}</SectionTitle>
        {students.length === 0 ? (
          <p className="px-2.5 pb-1 text-[11.5px] leading-snug" style={{ color: 'var(--t3)' }}>
            {t('Tag a score with a student’s name in My Scores to see them here.')}
          </p>
        ) : students.map(([name, n]) => (
          <button key={name} onClick={() => onShowLibrary(name)} className={row}>
            <span className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
              style={{ background: avatarColor(name) }}>
              {name.trim()[0]?.toUpperCase()}
            </span>
            <span className="flex-1 min-w-0 text-[13px] font-medium truncate" style={{ color: 'var(--t)' }}>{name}</span>
            <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--t3)' }}>{n}</span>
          </button>
        ))}
        {students.length > 0 && unassigned > 0 && (
          <button onClick={() => onShowLibrary('')} className={row}>
            <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] shrink-0"
              style={{ border: '1.5px dashed var(--border-md)', color: 'var(--t3)' }}>?</span>
            <span className="flex-1 min-w-0 text-[13px] truncate" style={{ color: 'var(--t2)' }}>{t('No student yet')}</span>
            <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--t3)' }}>{unassigned}</span>
          </button>
        )}
      </div>

      {/* Library */}
      <div className="px-3 py-3" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
        <button onClick={() => onShowLibrary()} className={`${row} justify-between`}>
          <span className="flex items-center gap-2.5">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--t2)' }}><path d="M4 19.5V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z" /><path d="M8 7h6" /></svg>
            <span className="text-[13px] font-medium" style={{ color: 'var(--t)' }}>{t('My Scores')}</span>
          </span>
          <span className="text-[11px] tabular-nums px-1.5 py-0.5 rounded-md" style={{ color: 'var(--t3)', background: 'var(--surface)' }}>{myRooms.length}</span>
        </button>
      </div>
    </nav>
  );
}
