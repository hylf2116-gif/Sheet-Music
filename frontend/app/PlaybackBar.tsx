'use client';

import { useEffect, useRef, useState } from 'react';
import { useT, useLang } from '../lib/i18n';
import { backendUrl } from '../lib/config';
import { parseMusicXml, type ScoreModel } from '../lib/musicxml';
import { parseMidi } from '../lib/midi';
import { ScorePlayer, type Instrument } from '../lib/scorePlayer';
import { ScoreFollower, type OffNote } from '../lib/scoreFollower';
import { usePitch } from '../hooks/usePitch';

// Plays the recognized score: start/stop, speed, sound. While playing it highlights the bar
// being played and keeps it on screen (turning pages). Each person plays on their own device.
export interface AiMark { bar: number; kind: string; text: string }

export default function PlaybackBar({ roomId, ready, version, partial, imported, barBoxCount, startBar, onBar, keepInView, onScore, onMarkOffNotes, isHost, onAiMarks }: {
  roomId: string;
  imported?: { name: string; kind: string } | null; // teacher-added MusicXML/MIDI (used instead of recognition)
  barBoxCount?: number;                 // bars found on the PDF (to warn when the file doesn't match)
  ready: boolean;                       // the score has been recognized (with MusicXML)
  version?: string;                     // changes when more pages become ready: reload the notes
  partial?: boolean;                    // only the first pages are ready so far
  startBar: number | null;              // highlighted bar: play from there
  onBar: (bar: number | null) => void;  // bar being played (null when stopped)
  keepInView: (bar: number) => void;    // scroll so the bar is visible
  onScore?: (score: ScoreModel | null) => void;
  // Put the out-of-tune notes found while following on the score as marks
  onMarkOffNotes?: (notes: OffNote[]) => void;
  isHost?: boolean;
  // AI teaching marks to place on the score (teacher only)
  onAiMarks?: (marks: AiMark[]) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  async function askAi() {
    if (aiBusy) return;
    setAiBusy(true); setAiMsg('');
    try {
      let hostToken: string | null = null;
      try { hostToken = localStorage.getItem(`unino_host_${roomId}`); } catch {}
      let supabaseToken: string | null = null;
      if (!hostToken) {
        try {
          const { supabase } = await import('../lib/supabase');
          const { data } = await supabase.auth.getSession();
          supabaseToken = data.session?.access_token ?? null;
        } catch {}
      }
      const res = await fetch(backendUrl(`/omr/${roomId}/ai-marks`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostToken, supabaseToken, instrument: instrument === 'piano' ? 'cello' : instrument, lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setAiMsg(t(data.message || 'The AI could not make suggestions right now. Try again in a minute.')); return; }
      const marks: AiMark[] = Array.isArray(data.marks) ? data.marks : [];
      if (!marks.length) { setAiMsg(t('The AI had no suggestions for this score.')); return; }
      onAiMarks?.(marks);
      setAiMsg(t('{n} AI marks added. Undo removes them all.', { n: marks.length }));
    } catch {
      setAiMsg(t('Could not reach our server. Check your connection.'));
    } finally { setAiBusy(false); }
  }
  const [score, setScore] = useState<ScoreModel | null>(null);
  const [loadError, setLoadError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(80);
  const [instrument, setInstrument] = useState<Instrument>('piano');
  const playerRef = useRef<ScorePlayer | null>(null);
  const onBarRef = useRef(onBar);
  const keepRef = useRef(keepInView);
  const onScoreRef = useRef(onScore);
  useEffect(() => { onBarRef.current = onBar; keepRef.current = keepInView; onScoreRef.current = onScore; });

  // Load the notes: the teacher's imported file if there is one (exact), else the recognized score.
  useEffect(() => {
    if (!ready && !imported) return;
    let cancelled = false;
    (async () => {
      try {
        let model: ScoreModel;
        if (imported) {
          const res = await fetch(backendUrl(`/omr/${roomId}/import`));
          if (!res.ok) throw new Error('missing');
          model = imported.kind === 'midi' ? parseMidi(await res.arrayBuffer()) : parseMusicXml(await res.text());
        } else {
          const res = await fetch(backendUrl(`/omr/${roomId}/score-xml`));
          if (!res.ok) throw new Error('missing');
          model = parseMusicXml(await res.text());
        }
        if (cancelled) return;
        setScore(model);
        onScoreRef.current?.(model);
        if (model.tempo) setTempo(Math.round(Math.min(200, Math.max(30, model.tempo))));
        setLoadError('');
      } catch {
        if (!cancelled) setLoadError(t('Could not load the recognized notes.'));
      }
    })();
    return () => { cancelled = true; };
  }, [ready, roomId, version, imported?.name, imported?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // More pages arrived: give the running player the longer score instead of starting over.
  useEffect(() => {
    if (!score) return;
    const existing = playerRef.current;
    if (existing) {
      existing.setScore(score);
      const f = followerRef.current;
      if (f) { const nf = new ScoreFollower(score); nf.startAt(f.bar || 1); nf.off = f.off; followerRef.current = nf; }
      return;
    }
    const p = new ScorePlayer(score);
    p.onBar = bar => { onBarRef.current(bar); keepRef.current(bar); };
    p.onEnd = () => { setPlaying(false); onBarRef.current(null); };
    playerRef.current = p;
  }, [score]);
  // Stop sound when the bar goes away.
  useEffect(() => () => { playerRef.current?.dispose(); playerRef.current = null; }, []);

  useEffect(() => { if (playerRef.current) playerRef.current.instrument = instrument; }, [instrument, score]);
  useEffect(() => { playerRef.current?.setTempo(tempo); }, [tempo, score]);

  // ── Parts: demo (all) or accompaniment (the student's part muted) ──
  const [mutedPart, setMutedPart] = useState(-1);
  useEffect(() => {
    const p = playerRef.current;
    if (p) p.mutedParts = mutedPart >= 0 ? new Set([mutedPart]) : new Set();
  }, [mutedPart, score]);

  // ── Loop bars A–B ──
  const [looping, setLooping] = useState(false);
  const [loopFrom, setLoopFrom] = useState(1);
  const [loopTo, setLoopTo] = useState(4);
  useEffect(() => {
    playerRef.current?.setLoopBars(looping ? { from: loopFrom, to: loopTo } : null);
  }, [looping, loopFrom, loopTo, score]);
  function toggleLoop() {
    if (!looping) {
      const a = startBar ?? 1;
      const max = score?.bars.length ?? a;
      setLoopFrom(a); setLoopTo(Math.min(max, a + 3));
    }
    setLooping(l => !l);
  }

  // ── Teacher adds / removes a MusicXML or MIDI file ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState('');
  async function hostCreds() {
    let hostToken: string | null = null;
    try { hostToken = localStorage.getItem(`unino_host_${roomId}`); } catch {}
    let supabaseToken: string | null = null;
    if (!hostToken) {
      try { const { supabase } = await import('../lib/supabase'); const { data } = await supabase.auth.getSession(); supabaseToken = data.session?.access_token ?? null; } catch {}
    }
    return { hostToken, supabaseToken };
  }
  async function uploadScoreFile(file: File) {
    setImportMsg(t('Adding {name}…', { name: file.name }));
    try {
      const { hostToken, supabaseToken } = await hostCreds();
      const fd = new FormData();
      fd.append('score', file);
      if (hostToken) fd.append('hostToken', hostToken);
      if (supabaseToken) fd.append('supabaseToken', supabaseToken);
      const res = await fetch(backendUrl(`/omr/${roomId}/import`), { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      setImportMsg(res.ok ? t('Playing from {name}', { name: data.name || file.name }) : t(data.error || 'Could not read this file.'));
    } catch { setImportMsg(t('Could not reach our server. Check your connection.')); }
  }
  async function removeScoreFile() {
    const creds = await hostCreds();
    await fetch(backendUrl(`/omr/${roomId}/import/remove`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
    }).catch(() => {});
    setImportMsg('');
  }

  // ── Follow me: listen to the player and move along the score ──
  const [following, setFollowing] = useState(false);
  const [offNotes, setOffNotes] = useState<OffNote[]>([]);
  const followerRef = useRef<ScoreFollower | null>(null);
  const micInstrument = instrument === 'piano' ? 'custom' : instrument;
  const { reading, error: micError } = usePitch(following, micInstrument);
  useEffect(() => {
    const f = followerRef.current;
    if (!following || !f || !reading) return;
    const before = f.bar;
    const bar = f.feed({ midi: reading.midi, cents: reading.cents, active: reading.active }, performance.now());
    if (bar !== before && bar > 0) { onBarRef.current(bar); keepRef.current(bar); }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show newly found out-of-tune notes
    if (f.off.length !== offNotes.length) setOffNotes([...f.off]);
  }, [reading, following]); // eslint-disable-line react-hooks/exhaustive-deps
  function toggleFollow() {
    if (following) { setFollowing(false); onBar(null); return; }
    if (!score) return;
    playerRef.current?.stop(); setPlaying(false);
    const f = new ScoreFollower(score);
    f.startAt(startBar ?? 1);
    // eslint-disable-next-line react-hooks/immutability -- the follower lives in a ref and is updated outside rendering
    followerRef.current = f;
    setOffNotes([]);
    onBar(startBar ?? 1);
    setFollowing(true);
  }

  // Space bar starts/stops playback (not while typing).
  const toggleRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey && playerRef.current) { e.preventDefault(); toggleRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function toggle() {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) { p.stop(); setPlaying(false); onBar(null); return; }
    if (following) setFollowing(false);
    p.tempo = tempo; p.instrument = instrument;
    p.playFromBar(looping ? Math.min(loopFrom, loopTo) : (startBar ?? 1));
    setPlaying(true);
  }

  // eslint-disable-next-line react-hooks/refs -- the Space shortcut always calls the latest toggle
  toggleRef.current = toggle;

  const hasSource = ready || !!imported;
  if (!hasSource && !isHost) return null;
  const parts = score?.parts ?? [];
  const mismatch = score && barBoxCount && Math.abs(score.bars.length - barBoxCount) > 0
    ? t('This file has {a} bars, the PDF {b}: highlights may be off.', { a: score.bars.length, b: barBoxCount }) : '';
  const fileInput = (
    <input ref={fileRef} type="file" accept=".mid,.midi,.musicxml,.xml,.mxl" className="hidden"
      onChange={e => { const f = e.target.files?.[0]; if (f) uploadScoreFile(f); e.target.value = ''; }} />
  );
  // Teacher, nothing to play yet: just offer to add a file.
  if (!hasSource) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl shadow-xl text-white" style={{ background: 'rgba(17,17,17,0.82)', backdropFilter: 'blur(12px)' }}>
        {fileInput}
        <button onClick={() => fileRef.current?.click()} className="h-9 px-3 rounded-full bg-white/10 hover:bg-white/20 text-[12px] font-semibold">
          ♪ {t('Add MusicXML / MIDI for playback')}
        </button>
        {importMsg && <span className="text-[11px] text-white/70 max-w-[220px] truncate">{importMsg}</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-2xl shadow-xl text-white"
      style={{ background: 'rgba(17,17,17,0.82)', backdropFilter: 'blur(12px)' }}>
      <button onClick={toggle} disabled={!score}
        title={playing ? t('Stop') + ' (Space)' : t('Play the score') + ' (Space)'}
        aria-label={playing ? t('Stop') : t('Play the score')}
        className="w-9 h-9 rounded-full flex items-center justify-center bg-white text-gray-900 hover:bg-white/90 disabled:opacity-40 shrink-0">
        {playing
          ? <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          : <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
      </button>
      <div className="flex flex-col min-w-0">
        <span className="text-[11px] font-semibold leading-tight whitespace-nowrap">
          {loadError || micError && t(micError) || (score
            ? (following ? t('Listening…') : playing ? t('Playing') : t('From bar {n}', { n: startBar ?? 1 }))
            : t('Loading notes…'))}
        </span>
        <span className="text-[10px] text-white/50 leading-tight whitespace-nowrap">
          {importMsg || mismatch || aiMsg || (following
            ? (offNotes.length ? t('{n} notes out of tune', { n: offNotes.length }) : t('Play — the score follows you'))
            : partial ? t('First pages ready · the rest is still being read') : t('Starts at the highlighted bar'))}
        </span>
      </div>
      <button onClick={toggleFollow} disabled={!score}
        title={following ? t('Stop listening') : t('Follow me: the score moves as you play')}
        aria-label={following ? t('Stop listening') : t('Follow me')} aria-pressed={following}
        className={`h-9 px-3 rounded-full flex items-center gap-1.5 text-[12px] font-semibold shrink-0 disabled:opacity-40 ${
          following ? 'bg-rose-500 text-white' : 'bg-white/10 hover:bg-white/20'}`}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        {following ? t('Listening') : t('Follow me')}
      </button>
      {offNotes.length > 0 && onMarkOffNotes && (
                <button onClick={() => { onMarkOffNotes(offNotes); setOffNotes([]); followerRef.current?.clearOff(); }}
          className="h-9 px-3 rounded-full text-[12px] font-semibold bg-amber-400 text-gray-900 hover:bg-amber-300 shrink-0 whitespace-nowrap">
          {t('Mark them on the score')}
        </button>
      )}
      {isHost && onAiMarks && (
        <button onClick={askAi} disabled={!score || aiBusy}
          title={aiMsg || t('AI suggests teaching marks for this score (fingering, shifts, bowing, hard spots)')}
          className="h-9 px-3 rounded-full flex items-center gap-1.5 text-[12px] font-semibold shrink-0 disabled:opacity-50 bg-violet-500/90 hover:bg-violet-500">
          <span aria-hidden>✦</span>{aiBusy ? t('Thinking…') : t('AI marks')}
        </button>
      )}
      {parts.length > 1 && (
        <select value={mutedPart} onChange={e => setMutedPart(Number(e.target.value))} aria-label={t('Which parts to play')}
          title={t('Which parts to play')} className="h-8 rounded-lg bg-white/10 text-[12px] px-1.5 outline-none shrink-0 max-w-[150px]">
          <option value={-1}>{t('All parts (demo)')}</option>
          {parts.map((name, i) => <option key={i} value={i}>{t('Accompaniment: mute {part}', { part: name })}</option>)}
        </select>
      )}
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={toggleLoop} disabled={!score} aria-pressed={looping} title={t('Loop bars')}
          className={`h-8 px-2.5 rounded-full text-[12px] font-semibold disabled:opacity-40 ${looping ? 'bg-sky-400 text-gray-900' : 'bg-white/10 hover:bg-white/20'}`}>
          ⟲ {t('Loop')}
        </button>
        {looping && (
          <span className="flex items-center gap-1 text-[11px] text-white/70">
            <input type="number" min={1} max={score?.bars.length ?? 999} value={loopFrom} aria-label={t('Loop from bar')}
              onChange={e => setLoopFrom(Math.max(1, Number(e.target.value) || 1))}
              className="w-11 h-7 rounded-md bg-white/10 text-white text-center outline-none" />
            –
            <input type="number" min={1} max={score?.bars.length ?? 999} value={loopTo} aria-label={t('Loop to bar')}
              onChange={e => setLoopTo(Math.max(1, Number(e.target.value) || 1))}
              className="w-11 h-7 rounded-md bg-white/10 text-white text-center outline-none" />
          </span>
        )}
      </div>
      {isHost && (
        <>
          {fileInput}
          <button onClick={() => (imported ? removeScoreFile() : fileRef.current?.click())}
            title={imported ? t('Stop using {name}; play the recognized score instead', { name: imported.name }) : t('Add a MusicXML or MIDI file: exact notes for demo or accompaniment')}
            className="h-8 px-2.5 rounded-full text-[11px] bg-white/10 hover:bg-white/20 shrink-0 max-w-[140px] truncate">
            {imported ? `♪ ${imported.name} ✕` : `♪ ${t('Add file')}`}
          </button>
        </>
      )}
      <label className="flex items-center gap-1.5 text-[11px] text-white/70 shrink-0" title={t('Speed (quarter notes per minute)')}>
        ♩=
        <input type="range" min={30} max={200} value={tempo} onChange={e => setTempo(Number(e.target.value))}
          className="w-20" style={{ accentColor: '#a5b4fc' }} aria-label={t('Speed (quarter notes per minute)')} />
        <span className="tabular-nums w-7 text-white">{tempo}</span>
      </label>
      <select value={instrument} onChange={e => setInstrument(e.target.value as Instrument)} aria-label={t('Sound')}
        className="h-8 rounded-lg bg-white/10 text-[12px] px-1.5 outline-none shrink-0">
        <option value="piano">{t('Piano')}</option>
        <option value="cello">{t('Cello')}</option>
        <option value="erhu">{t('Erhu')}</option>
      </select>
    </div>
  );
}
