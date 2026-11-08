'use client';

import { useState } from 'react';
import { supabase } from '../lib/supabase';

type Tab = 'login' | 'signup';

function friendlyError(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials'))
    return 'Incorrect email or password.';
  if (msg.includes('email not confirmed'))
    return 'Please confirm your email address before signing in.';
  if (msg.includes('user already registered') || msg.includes('already exists') || msg.includes('already been registered'))
    return 'An account with this email already exists. Try logging in instead.';
  if (msg.includes('password should be at least') || msg.includes('password must be'))
    return 'Password must be at least 6 characters.';
  if (msg.includes('unable to validate email') || msg.includes('invalid email'))
    return 'Please enter a valid email address.';
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('over_email_send_rate_limit'))
    return 'Too many attempts. Please wait a moment and try again.';
  if (msg.includes('network') || msg.includes('failed to fetch'))
    return 'Could not reach the account service. Check the browser console for details.';
  return raw;
}

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  function switchTab(t: Tab) { setTab(t); setError(''); setSuccess(''); }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      console.error('[AuthModal] Sign-in error:', error);
      setError(friendlyError(error.message));
    }
    // onAuthStateChange in page.tsx closes the modal on success
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name.trim() } },
    });
    setLoading(false);
    if (error) {
      console.error('[AuthModal] Sign-up error:', error);
      setError(friendlyError(error.message)); return;
    }
    // If email confirmation is disabled the session is created immediately
    if (data.session) {
      // onAuthStateChange fires → modal closes automatically
    } else {
      setSuccess('Check your inbox to confirm your email, then sign in.');
    }
  }

  const inputCls =
    'w-full u-input rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-colors';

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="unino-modal rounded-2xl w-full max-w-sm p-6 shadow-2xl" style={{ backgroundColor: 'var(--modal-bg)', border: '1px solid var(--border-md)' }}>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-base font-bold">
            {tab === 'login' ? 'Sign in to Unino' : 'Create your account'}
          </h2>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex gap-1 bg-white/5 rounded-xl p-1 mb-5">
          {(['login', 'signup'] as Tab[]).map(t => (
            <button key={t} onClick={() => switchTab(t)}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'
              }`}>
              {t === 'login' ? 'Log in' : 'Sign up'}
            </button>
          ))}
        </div>

        {success ? (
          <div className="text-center py-6">
            <div className="text-2xl mb-3">📬</div>
            <p className="text-emerald-400 text-sm leading-relaxed">{success}</p>
            <button onClick={() => switchTab('login')}
              className="mt-4 text-sm text-gray-400 hover:text-white transition-colors underline underline-offset-2">
              Back to log in
            </button>
          </div>
        ) : (
          <form onSubmit={tab === 'login' ? handleLogin : handleSignup} className="flex flex-col gap-3">
            {tab === 'signup' && (
              <input type="text" placeholder="Your name" value={name}
                onChange={e => setName(e.target.value)} required autoFocus className={inputCls} />
            )}
            <input type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} required autoFocus={tab === 'login'} className={inputCls} />
            <input type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)} required minLength={6} className={inputCls} />

            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="text-red-400 text-xs leading-snug">{error}</p>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 mt-1">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {tab === 'login' ? 'Signing in…' : 'Creating account…'}
                </span>
              ) : (
                tab === 'login' ? 'Sign in' : 'Create account'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
