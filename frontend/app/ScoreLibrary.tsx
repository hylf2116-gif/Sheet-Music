'use client';

import { useEffect, useMemo, useState } from 'react';
import Glyph from './Glyph';
import { useT, type TFunc } from '../lib/i18n';
import { updateRoomMeta, deleteRoomForEveryone, type LibraryRoom } from '../lib/library';
import RowMenu from './RowMenu';

// "My Scores": every score you host, grouped by student. Reopening a score returns to the same room,
// with all annotations from earlier lessons.
export default function ScoreLibrary({ rooms, onRoomsChange, onOpen, onClose, onRoomDeleted, pinned = [], onTogglePin, student, onTechniques }: {
  rooms: LibraryRoom[];
  onRoomsChange: (rooms: LibraryRoom[]) => void;
  onOpen: (roomId: string) => void;
  onClose: () => void;
  onRoomDeleted: (roomId: string) => void;
  pinned?: string[];
  onTogglePin?: (roomId: string) => void;
  // Show only one student's scores ('' = scores without a student); undefined = all
  student?: string;
  onTechniques?: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [onlyStudent, setOnlyStudent] = useState<string | undefined>(student);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftStudent, setDraftStudent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing]);

  const students = useMemo(
    () => [...new Set(rooms.map(r => r.studentTag).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rooms],
  );

  // Groups: one per student (A–Z), then scores without a student.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = onlyStudent === undefined ? rooms : rooms.filter(r => (r.studentTag || '') === onlyStudent);
    const shown = q
      ? base.filter(r => r.scoreName.toLowerCase().includes(q) || r.studentTag.toLowerCase().includes(q))
      : base;
    const map = new Map<string, LibraryRoom[]>();
    for (const r of shown) {
      const k = r.studentTag || '';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [rooms, query, onlyStudent]);

  function startEdit(r: LibraryRoom) {
    setEditing(r.roomId); setDraftName(r.scoreName); setDraftStudent(r.studentTag); setError('');
  }

  async function saveEdit(roomId: string) {
    setError('');
    try {
      const updated = await updateRoomMeta(roomId, { scoreName: draftName, studentTag: draftStudent });
      if (updated) onRoomsChange(rooms.map(r => (r.roomId === roomId ? updated : r)));
      setEditing(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
  }

  async function remove(r: LibraryRoom) {
    if (!window.confirm(t('Delete “{name}” for everyone? Its annotations and chat will be gone for good.', { name: r.scoreName }))) return;
    setError('');
    try {
      await deleteRoomForEveryone(r.roomId);
      onRoomsChange(rooms.filter(x => x.roomId !== r.roomId));
      onRoomDeleted(r.roomId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the room.'); }
  }

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-label={t('My Scores')}>
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="unino-modal w-full max-w-lg flex flex-col shadow-2xl overflow-hidden"
        style={{ animation: 'slideInRight 0.2s ease', backgroundColor: 'var(--panel-bg)', borderLeft: '1px solid var(--panel-border)' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--divider)' }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--t)' }}>{t('My Scores')}</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>{t('Scores you teach from. Annotations stay from lesson to lesson.')}</p>
          </div>
          {onTechniques && (
            <button onClick={onTechniques} className="ml-auto mr-2 cp-chip px-3 py-1.5 text-xs rounded-lg" style={{ color: 'var(--t)' }}>
              {t('Technique library')}
            </button>
          )}
          <button onClick={onClose} aria-label={t('Close')}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.05]" style={{ color: 'var(--t3)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ width: 14, height: 14 }}><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 pt-4 shrink-0">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search scores or students…')}
            className="w-full u-input rounded-xl px-3.5 py-2.5 text-sm focus:outline-none" />
          {onlyStudent !== undefined && (
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs" style={{ color: 'var(--t3)' }}>{t('Showing')}</span>
              <button onClick={() => setOnlyStudent(undefined)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>
                {onlyStudent || t('No student yet')} <Glyph name="close" size={11} />
              </button>
            </div>
          )}
          {error && <p role="alert" className="text-xs mt-2" style={{ color: '#ef4444' }}>{t(error)}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
          {rooms.length === 0 && (
            <div className="text-center py-16">
              <p className="text-sm font-medium" style={{ color: 'var(--t2)' }}>{t('No scores yet')}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>{t('Scores you upload and teach from will appear here.')}</p>
            </div>
          )}
          {rooms.length > 0 && groups.length === 0 && (
            <p className="text-sm text-center py-10" style={{ color: 'var(--t3)' }}>{t('Nothing matches your search.')}</p>
          )}
          {groups.map(([student, list]) => (
            <section key={student || '_none'}>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: 'var(--t3)' }}>
                {student ? <><Glyph name="person" size={12} />{student}</> : t('No student yet')}
                <span className="font-normal normal-case tracking-normal">· {list.length}</span>
              </h3>
              <div className="flex flex-col gap-2">
                {list.map(r => editing === r.roomId ? (
                  <form key={r.roomId} onSubmit={e => { e.preventDefault(); saveEdit(r.roomId); }}
                    className="flex flex-col gap-2 p-3.5" style={{ background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 'var(--r-lg)' }}>
                    <label className="text-xs font-medium" style={{ color: 'var(--t3)' }}>{t('Score name')}</label>
                    <input value={draftName} onChange={e => setDraftName(e.target.value)} maxLength={120} autoFocus
                      className="u-input rounded-lg px-3 py-2 text-sm focus:outline-none" />
                    <label className="text-xs font-medium" style={{ color: 'var(--t3)' }}>{t('Student')}</label>
                    <input value={draftStudent} onChange={e => setDraftStudent(e.target.value)} maxLength={60}
                      list="unino-students" placeholder={t('e.g. Amy (leave empty for none)')}
                      className="u-input rounded-lg px-3 py-2 text-sm focus:outline-none" />
                    <datalist id="unino-students">{students.map(s => <option key={s} value={s} />)}</datalist>
                    <div className="flex gap-2 justify-end mt-1">
                      <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 text-sm rounded-lg" style={{ color: 'var(--t2)' }}>{t('Cancel')}</button>
                      <button type="submit" className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white font-medium">{t('Save')}</button>
                    </div>
                  </form>
                ) : (
                  <div key={r.roomId} className="flex items-center gap-3 px-3.5 py-3 unino-session-row" style={{ borderRadius: 'var(--r-lg)' }}>
                    <button type="button" onClick={() => onOpen(r.roomId)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                      <div className="w-9 h-9 flex items-center justify-center shrink-0"
                        style={{ borderRadius: 'var(--r-sm)', background: 'var(--accent-bg)', border: '1px solid rgba(94,92,230,0.2)' }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                          className="w-4 h-4" style={{ color: 'var(--accent-fg)' }}>
                          <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate u-text">{r.scoreName}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>
                          {when(r.lastActive, t)} · {t('{n} annotations', { n: r.annotationCount })}
                        </p>
                      </div>
                    </button>
                    {onTogglePin && (
                      <button type="button" onClick={() => onTogglePin(r.roomId)}
                        aria-label={pinned.includes(r.roomId) ? t('Unpin') : t('Pin to sidebar')}
                        title={pinned.includes(r.roomId) ? t('Unpin') : t('Pin to sidebar')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 hover:bg-black/[0.06] text-base"
                        style={{ color: pinned.includes(r.roomId) ? '#f59e0b' : 'var(--t3)' }}>
                        {pinned.includes(r.roomId) ? <Glyph name="starFill" /> : <Glyph name="star" />}
                      </button>
                    )}
                    <RowMenu items={[
                      { label: t('Open'), onClick: () => onOpen(r.roomId) },
                      { label: t('Rename or set student'), onClick: () => startEdit(r) },
                      { label: t('Delete room for everyone'), onClick: () => remove(r), danger: true },
                    ]} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function when(iso: string | null, t: TFunc) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return t('Today');
  if (days === 1) return t('Yesterday');
  if (days < 7) return t('{n} days ago', { n: days });
  return new Date(iso).toLocaleDateString(t('en-US'), { month: 'short', day: 'numeric' });
}
