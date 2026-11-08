'use client';

import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { deleteSession, type RecentSession } from '../lib/sessions';

export type PanelTab = 'profile' | 'sessions' | 'settings';
export type Theme = 'auto' | 'dark' | 'light';

interface Props {
  user: User;
  sessions: RecentSession[];
  initialTab: PanelTab;
  theme: Theme;
  onClose: () => void;
  onOpenRoom: (roomId: string) => void;
  onSessionsChange: (sessions: RecentSession[]) => void;
  onThemeChange: (t: Theme) => void;
  onUserUpdated: (u: User) => void;
  onSignOut: () => void;
}

function relativeTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Profile Tab ───────────────────────────────────────────────────────────────

function ProfileTab({ user, onUserUpdated }: { user: User; onUserUpdated: (u: User) => void }) {
  const [name, setName] = useState((user.user_metadata?.full_name as string) ?? '');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState('');

  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  const inputCls = 'w-full u-input rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors';

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameSaving(true); setNameMsg('');
    const { data, error } = await supabase.auth.updateUser({ data: { full_name: name.trim() } });
    setNameSaving(false);
    if (error) setNameMsg(error.message);
    else { setNameMsg('Saved!'); if (data.user) onUserUpdated(data.user); }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) { setPwMsg("Passwords don't match."); return; }
    if (newPw.length < 6) { setPwMsg('Password must be at least 6 characters.'); return; }
    setPwSaving(true); setPwMsg('');
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwSaving(false);
    if (error) setPwMsg(error.message);
    else { setPwMsg('Password updated!'); setNewPw(''); setConfirmPw(''); }
  }

  const initials = name.trim()
    ? name.trim().split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : (user.email?.[0] ?? '?').toUpperCase();

  return (
    <div className="flex flex-col gap-6">
      {/* Avatar + identity */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-xl font-bold text-white select-none shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{name || user.email}</p>
          <p className="text-xs text-gray-500 truncate">{user.email}</p>
        </div>
      </div>

      {/* Display name */}
      <form onSubmit={saveName} className="flex flex-col gap-2">
        <label className="text-xs font-medium text-gray-400">Display name</label>
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
        <div className="flex items-center justify-between">
          {nameMsg && <p className={`text-xs ${nameMsg === 'Saved!' ? 'text-emerald-400' : 'text-red-400'}`}>{nameMsg}</p>}
          <button type="submit" disabled={nameSaving}
            className="ml-auto px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50">
            {nameSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      {/* Email (read-only) */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-gray-400">Email address</label>
        <div className="px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-gray-500 select-all">
          {user.email}
        </div>
        <p className="text-[11px] text-gray-700">To change your email, contact support.</p>
      </div>

      <div className="h-px u-divider" />

      {/* Change password */}
      <form onSubmit={savePassword} className="flex flex-col gap-2">
        <label className="text-xs font-medium text-gray-400">Change password</label>
        <input className={inputCls} type="password" placeholder="New password" value={newPw} onChange={e => setNewPw(e.target.value)} autoComplete="new-password" />
        <input className={inputCls} type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} autoComplete="new-password" />
        {pwMsg && <p className={`text-xs ${pwMsg === 'Password updated!' ? 'text-emerald-400' : 'text-red-400'}`}>{pwMsg}</p>}
        <button type="submit" disabled={pwSaving || !newPw}
          className="self-end px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 transition-colors disabled:opacity-40">
          {pwSaving ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}

// ── Sessions Tab ──────────────────────────────────────────────────────────────

function SessionsTab({
  sessions, onOpenRoom, onSessionsChange,
}: { sessions: RecentSession[]; onOpenRoom: (id: string) => void; onSessionsChange: (s: RecentSession[]) => void }) {
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeleting(id);
    await deleteSession(id);
    onSessionsChange(sessions.filter(s => s.id !== id));
    setDeleting(null);
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <span className="text-4xl">🎵</span>
        <p className="text-sm text-gray-400 font-medium">No sessions yet</p>
        <p className="text-xs text-gray-600">Sessions you create or join will appear here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {sessions.map(s => (
        <div key={s.id}
          className="flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-2xl px-4 py-3 transition-colors group">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center shrink-0 text-sm">
            🎼
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{s.score_name}</p>
            <p className="text-xs text-gray-600">{relativeTime(s.last_accessed)}</p>
          </div>
          <button onClick={() => onOpenRoom(s.room_id)} title="Reopen"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-600 hover:text-white hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <button onClick={() => handleDelete(s.id)} disabled={deleting === s.id} title="Delete"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30">
            {deleting === s.id ? (
              <span className="w-3.5 h-3.5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab({ theme, onThemeChange, onSignOut }: {
  theme: Theme; onThemeChange: (t: Theme) => void; onSignOut: () => void;
}) {
  const [notifEmail, setNotifEmail] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm'>('idle');
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteAccount() {
    if (deleteInput !== 'DELETE') return;
    setDeleting(true);
    // Delete session history, then sign out.
    // Full account deletion requires a Supabase RPC or admin call — see migration SQL.
    try { await supabase.rpc('delete_own_user'); } catch {}
    await supabase.auth.signOut();
    onSignOut();
  }

  const themeOptions: { value: Theme; label: string; icon: string }[] = [
    { value: 'auto',  label: 'Auto',  icon: '💻' },
    { value: 'dark',  label: 'Dark',  icon: '🌙' },
    { value: 'light', label: 'Light', icon: '☀️'  },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Theme */}
      <div>
        <p className="text-xs font-medium text-gray-400 mb-2.5">Theme</p>
        <div className="grid grid-cols-3 gap-2">
          {themeOptions.map(opt => (
            <button key={opt.value} onClick={() => onThemeChange(opt.value)}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-sm transition-all ${
                theme === opt.value
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-white'
                  : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:bg-white/[0.07]'
              }`}>
              <span>{opt.icon}</span>
              <span className="text-xs font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="h-px u-divider" />

      {/* Notifications */}
      <div>
        <p className="text-xs font-medium text-gray-400 mb-2.5">Notifications</p>
        <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] cursor-pointer">
          <div>
            <p className="text-sm text-gray-300 font-medium">Email reminders</p>
            <p className="text-xs text-gray-600 mt-0.5">Get notified when someone joins your session</p>
          </div>
          <div onClick={() => setNotifEmail(v => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${notifEmail ? 'bg-indigo-600' : 'bg-white/10'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${notifEmail ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
        </label>
      </div>

      <div className="h-px u-divider" />

      {/* Danger zone */}
      <div>
        <p className="text-xs font-semibold text-red-500/70 uppercase tracking-widest mb-2.5">Danger zone</p>

        {deleteStep === 'idle' ? (
          <button onClick={() => setDeleteStep('confirm')}
            className="w-full py-2.5 rounded-xl border border-red-500/30 text-sm text-red-400 hover:bg-red-500/10 transition-colors font-medium">
            Delete account
          </button>
        ) : (
          <div className="flex flex-col gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/5">
            <p className="text-sm text-red-300 font-medium">This is permanent</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Your account and all session history will be deleted and cannot be recovered.
            </p>
            <p className="text-xs text-gray-500">Type <span className="font-mono text-red-400">DELETE</span> to confirm</p>
            <input
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder="DELETE"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-500/40 transition-colors font-mono"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => { setDeleteStep('idle'); setDeleteInput(''); }}
                className="flex-1 py-2 rounded-xl text-xs font-medium text-gray-400 bg-white/5 hover:bg-white/10 border border-white/8 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteInput !== 'DELETE' || deleting}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-40">
                {deleting ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AccountPanel({
  user, sessions, initialTab, theme,
  onClose, onOpenRoom, onSessionsChange, onThemeChange, onUserUpdated, onSignOut,
}: Props) {
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabs: { id: PanelTab; label: string }[] = [
    { id: 'profile',  label: 'Profile'   },
    { id: 'sessions', label: 'Sessions'  },
    { id: 'settings', label: 'Settings'  },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div ref={panelRef}
        className="unino-modal w-full max-w-sm flex flex-col shadow-2xl overflow-hidden"
        style={{ animation: 'slideInRight 0.2s ease', backgroundColor: 'var(--panel-bg)', borderLeft: '1px solid var(--panel-border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <h2 className="text-sm font-semibold text-white">Account</h2>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-5 pt-3 shrink-0 border-b border-white/[0.06]">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'profile' && (
            <ProfileTab user={user} onUserUpdated={onUserUpdated} />
          )}
          {tab === 'sessions' && (
            <SessionsTab sessions={sessions} onOpenRoom={(id) => { onOpenRoom(id); onClose(); }} onSessionsChange={onSessionsChange} />
          )}
          {tab === 'settings' && (
            <SettingsTab theme={theme} onThemeChange={onThemeChange} onSignOut={onSignOut} />
          )}
        </div>

        {/* Footer sign-out */}
        <div className="shrink-0 px-5 py-4 border-t border-white/[0.06]">
          <button onClick={onSignOut}
            className="w-full py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/30 transition-colors">
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
