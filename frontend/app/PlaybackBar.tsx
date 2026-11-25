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

export default function PlaybackBar({ roomId, ready, version, partial, imported, barBoxCount, startBar, onBar, keepInView, onScore, onMarkOffNotes, isHost, onAiMarks, canPick, pickMode, onPickMode, pickedBar, onLoopBars }: {
  canPick?: boolean;                    // bar boxes exist, so bars can be clicked on the score
  pickMode?: boolean;                   // "click the score to play" is on
  onPickMode?: (on: boolean) => void;
  pickedBar?: { n: number; shift: boolean; nonce: number } | null; // a bar clicked on the score in that mode
  onLoopBars?: (r: { from: number; to: number } | null) => void;  // shade the looped bars on the score
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
        body: JSON.stringify({ hostToken, supabaseToken, instrument: instrument === 'violin' ? 'violin' : 'cello', lang }),
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
  const [loadingSounds, setLoadingSounds] = useState(false);
  const [tempo, setTempo] = useState(80);
  const [instrument, setInstrument] = useState<Instrument>('auto');
  const playerRef = useRef<ScorePlayer | null>(null);
  // Where Play starts: a bar the person picks (or the highlighted bar), or where they paused.
  const [fromBar, setFromBar] = useState(1);
  const [resumeAt, setResumeAt] = useState<number | null>(null);  // performance seconds, after a pause
  const [atBar, setAtBar] = useState<number | null>(null);         // bar now playing / paused on
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
    p.onBar = bar => { setAtBar(bar); onBarRef.current(bar); keepRef.current(bar); };
    p.onEnd = () => { setPlaying(false); setResumeAt(null); setAtBar(null); onBarRef.current(null); };
    p.onLoading = setLoadingSounds;
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
    onLoopBars?.(looping ? { from: loopFrom, to: loopTo } : null);
  }, [looping, loopFrom, loopTo, score]); // eslint-disable-line react-hooks/exhaustive-deps
  // Choosing a loop by tapping two bars on the score (works on touch screens, no Shift key needed)
  const [loopPick, setLoopPick] = useState<null | 'first' | { from: number }>(null);
  function toggleLoop() {
    if (loopPick) { setLoopPick(null); onLoopBars?.(null); return; }        // cancel choosing
    if (!looping && canPick && onPickMode) { setLoopPick('first'); onPickMode(true); return; }
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
  const micInstrument = instrument === 'violin' || instrument === 'cello' ? instrument : 'custom';
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
    playerRef.current?.stop(); setPlaying(false); setResumeAt(null);
    const f = new ScoreFollower(score);
    f.startAt(fromBar);
    // eslint-disable-next-line react-hooks/immutability -- the follower lives in a ref and is updated outside rendering
    followerRef.current = f;
    setOffNotes([]);
    onBar(fromBar);
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
    if (playing) { p.stop(); setPlaying(false); setResumeAt(p.currentTime()); return; } // pause: keep the place
    if (following) setFollowing(false);
    p.tempo = tempo; p.instrument = instrument;
    if (looping) p.playFromBar(Math.min(loopFrom, loopTo));
    else if (resumeAt != null) void p.play(resumeAt);
    else p.playFromBar(fromBar);
    setPlaying(true);
  }
  /** Start (or jump) at a bar the person chose. */
  function goToBar(n: number) {
    const max = score?.bars.length ?? n;
    const bar = Math.max(1, Math.min(max, Math.round(n) || 1));
    setFromBar(bar); setResumeAt(null);
    const p = playerRef.current;
    if (p && playing) { p.instrument = instrument; p.playFromBar(bar); }
    else if (atBar != null) { setAtBar(null); onBar(null); }
  }
  /** Clicked on the score: play from that bar at once. Shift-click: loop from the start bar to it. */
  function pickBar(n: number, shift: boolean) {
    const p = playerRef.current;
    if (!p || !score) return;
    const bar = Math.max(1, Math.min(score.bars.length, n));
    if (loopPick === 'first') { setLoopPick({ from: bar }); onLoopBars?.({ from: bar, to: bar }); return; }
    if (loopPick) {
      const a = Math.min(loopPick.from, bar), z = Math.max(loopPick.from, bar);
      setLoopPick(null);
      setLoopFrom(a); setLoopTo(z); setLooping(true); setFromBar(a); setResumeAt(null);
      p.setLoopBars({ from: a, to: z });
      p.tempo = tempo; p.instrument = instrument;
      p.playFromBar(a); setPlaying(true);
      return;
    }
    if (shift) {
      const a = atBar ?? fromBar;
      setLoopFrom(Math.min(a, bar)); setLoopTo(Math.max(a, bar)); setLooping(true);
      p.setLoopBars({ from: Math.min(a, bar), to: Math.max(a, bar) });
      if (!playing) { p.tempo = tempo; p.instrument = instrument; p.playFromBar(Math.min(a, bar)); setPlaying(true); }
      return;
    }
    if (looping) { setLooping(false); p.setLoopBars(null); }
    setFromBar(bar); setResumeAt(null);
    if (following) setFollowing(false);
    p.tempo = tempo; p.instrument = instrument;
    p.playFromBar(bar);
    setPlaying(true);
  }
  const pickRef = useRef(pickBar);
  // eslint-disable-next-line react-hooks/refs -- the pick effect always calls the latest version
  pickRef.current = pickBar;
  useEffect(() => { if (pickedBar) pickRef.current(pickedBar.n, pickedBar.shift); }, [pickedBar]);

  // Progress line (moved every frame while playing) and the settings panel
  const progRef = useRef<HTMLDivElement>(null);
  const [showMore, setShowMore] = useState(false);
  /** Click on the progress line: jump there (keeps playing if it was). */
  function seek(frac: number) {
    const p = playerRef.current;
    if (!p) return;
    const at = p.timeAt(frac);
    if (progRef.current) progRef.current.style.width = `${(100 * frac).toFixed(2)}%`;
    if (playing) { p.instrument = instrument; void p.play(at); } else setResumeAt(at);
  }

  // Count-in before the music starts
  const [countIn, setCountIn] = useState(false);
  useEffect(() => { if (playerRef.current) playerRef.current.countIn = countIn; }, [countIn, score]);

  // Move the playhead line along the playing bar (drawn by the PDF viewer, moved here every frame)
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = () => {
      const pos = playerRef.current?.position();
      if (pos && progRef.current) progRef.current.style.width = `${(100 * pos.t / (pos.total || 1)).toFixed(2)}%`;
      const pr = playerRef.current?.progress();
      if (pr) {
        document.querySelectorAll<SVGLineElement>('line[data-playhead]').forEach(el => {
          if (Number(el.dataset.bar) !== pr.bar) return;
          const x = Number(el.dataset.x) + Number(el.dataset.w) * pr.frac;
          el.setAttribute('x1', String(x)); el.setAttribute('x2', String(x));
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const goToBarRef = useRef(goToBar);
  // eslint-disable-next-line react-hooks/refs -- the bar-click effect always calls the latest version
  goToBarRef.current = goToBar;
  // Clicking / highlighting a bar on the score: play from there (jumps there while playing).
  useEffect(() => { if (startBar != null) goToBarRef.current(startBar); }, [startBar]);
  // A new sound choice takes effect at once while playing.
  useEffect(() => {
    const p = playerRef.current;
    if (p?.playing && p.instrument !== instrument) { p.instrument = instrument; void p.play(p.currentTime()); }
  }, [instrument]);

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
      <div className="uplay-panel flex items-center gap-2 px-2 py-1.5 rounded-full text-[#f4efe6]">
        {fileInput}
        <button onClick={() => fileRef.current?.click()} className="h-9 px-4 rounded-full bg-white/[0.06] hover:bg-white/10 text-[12px] font-medium">
          ♪ {t('Add MusicXML / MIDI for playback')}
        </button>
        {importMsg && <span className="text-[11px] text-white/70 max-w-[220px] truncate">{importMsg}</span>}
      </div>
    );
  }
  const total = score?.bars.length ?? 0;
  const shownBar = atBar ?? fromBar;
  const title = loadError || (micError && t(micError)) || (!score ? t('Loading notes…')
    : following ? t('Listening…')
    : playing ? t('Playing') : resumeAt != null ? t('Paused') : t('Ready'));
  const caption = loopPick === 'first' ? t('Loop: tap the first bar on the score')
    : loopPick ? t('Loop: now tap the last bar')
    : importMsg || mismatch || aiMsg || (following
      ? (offNotes.length ? t('{n} notes out of tune', { n: offNotes.length }) : t('Play — the score follows you'))
      : loadingSounds ? t('Loading instrument sounds…')
      : partial ? t('First pages ready · the rest is still being read')
      : pickMode ? t('Tap a bar on the score to play from it.')
      : '');
  // loop range on the progress line (by written beats: close enough to show where it is)
  const loopF = (() => {
    if (!looping || !score?.totalBeats) return null;
    const lo = score.bars.find(b => b.n === Math.min(loopFrom, loopTo)), hi = score.bars.find(b => b.n === Math.max(loopFrom, loopTo));
    return lo && hi ? { a: lo.beat / score.totalBeats, b: (hi.beat + hi.beats) / score.totalBeats } : null;
  })();

  return (
    <div className="relative max-w-[calc(100vw-16px)] text-[#f4efe6]" style={{ fontFeatureSettings: '"tnum"' }}>
      {/* Settings panel: sound, parts, start bar, loop range, file */}
      {showMore && (
        <div className="uplay-panel absolute bottom-full mb-2 right-0 w-[300px] max-w-[calc(100vw-16px)] p-4 rounded-2xl flex flex-col gap-3.5"
          style={{ background: 'linear-gradient(180deg, #2a2622, #181614)' }}>
          <Field label={t('Sound')}>
            <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-black/30">
              {([['auto', t('Auto')], ['piano', t('Piano')], ['cello', t('Cello')], ['violin', t('Violin')]] as [Instrument, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setInstrument(v)} aria-pressed={instrument === v}
                  title={v === 'auto' ? t('Auto (by part)') : label}
                  className={`h-7 rounded-lg text-[11px] font-medium transition ${instrument === v ? 'bg-[#e8c48a] text-[#1c1812] shadow' : 'text-white/60 hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          {parts.length > 1 && (
            <Field label={t('Which parts to play')}>
              <select value={mutedPart} onChange={e => setMutedPart(Number(e.target.value))} aria-label={t('Which parts to play')}
                className="uplay-input w-full h-8 px-2 text-[12px]">
                <option value={-1}>{t('All parts (demo)')}</option>
                {parts.map((name, i) => <option key={i} value={i}>{t('Accompaniment: mute {part}', { part: name })}</option>)}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Start at bar')}>
              <input type="number" min={1} max={total || 999} value={fromBar} aria-label={t('Start at bar')}
                onChange={e => goToBar(Number(e.target.value))} className="uplay-input w-full h-8 text-center text-[12px]" />
            </Field>
            <Field label={t('Loop bars')}>
              <div className="flex items-center gap-1">
                <input type="number" min={1} max={total || 999} value={loopFrom} aria-label={t('Loop from bar')}
                  onChange={e => { setLoopFrom(Math.max(1, Number(e.target.value) || 1)); setLooping(true); }}
                  className="uplay-input w-full h-8 text-center text-[12px]" />
                <span className="text-white/40">–</span>
                <input type="number" min={1} max={total || 999} value={loopTo} aria-label={t('Loop to bar')}
                  onChange={e => { setLoopTo(Math.max(1, Number(e.target.value) || 1)); setLooping(true); }}
                  className="uplay-input w-full h-8 text-center text-[12px]" />
              </div>
            </Field>
          </div>
          <div className="sm:hidden">
            <Field label={t('Speed (quarter notes per minute)')}>
              <div className="flex items-center gap-3">
                <input type="range" min={30} max={200} value={tempo} onChange={e => setTempo(Number(e.target.value))}
                  className="flex-1" style={{ accentColor: '#e8c48a' }} aria-label={t('Speed (quarter notes per minute)')} />
                <span className="text-[13px] w-12 text-right">♩ {tempo}</span>
              </div>
            </Field>
          </div>
          <label className="flex items-center justify-between text-[12px] text-white/80">
            {t('Count-in')}<span className="text-white/40 text-[11px] ml-2 mr-auto">{t('One bar of clicks before playing')}</span>
            <Switch on={countIn} onClick={() => setCountIn(c => !c)} label={t('Count-in')} />
          </label>
          {isHost && (
            <div className="pt-3 border-t border-white/10">
              {fileInput}
              <button onClick={() => (imported ? removeScoreFile() : fileRef.current?.click())}
                title={imported ? t('Stop using {name}; play the recognized score instead', { name: imported.name }) : t('Add a MusicXML or MIDI file: exact notes for demo or accompaniment')}
                className="w-full h-8 rounded-lg text-[12px] text-white/80 bg-white/[0.06] hover:bg-white/10 truncate px-3">
                {imported ? `${imported.name} ✕` : t('Add MusicXML / MIDI file')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="uplay-panel flex items-center gap-1.5 sm:gap-2 pl-1.5 pr-2 py-1.5 rounded-full overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {/* Back to the start bar */}
        <IconBtn onClick={() => goToBar(fromBar)} disabled={!score} label={t('Back to bar {n}', { n: fromBar })} className="hidden sm:flex">
          <path d="M6 5v14M18 6l-9 6 9 6V6z" fill="currentColor" stroke="none" />
        </IconBtn>

        {/* Play / pause */}
        <button onClick={toggle} disabled={!score}
          title={playing ? t('Pause') + ' (Space)' : t('Play the score') + ' (Space)'}
          aria-label={playing ? t('Pause') : t('Play the score')}
          className="uplay-play w-11 h-11 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40 transition active:scale-95">
          {playing
            ? <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>
            : <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8.5 5.5v13a.8.8 0 0 0 1.2.7l10.2-6.5a.8.8 0 0 0 0-1.4L9.7 4.8a.8.8 0 0 0-1.2.7z" /></svg>}
        </button>

        {/* Bar counter + state */}
        <div className="flex flex-col justify-center shrink-0 w-[84px] sm:w-[124px] pl-1">
          <div className="flex items-baseline gap-1.5 leading-none">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[#e8c48a]/80">{t('Bar')}</span>
            <span className="text-[17px] font-semibold tracking-tight">{shownBar}</span>
            {total > 0 && <span className="text-[11px] text-white/35">/ {total}</span>}
          </div>
          <span className="text-[10.5px] text-white/50 leading-tight mt-1 truncate" title={caption || title}>{caption || title}</span>
        </div>

        {/* Progress through the whole piece (click to jump), loop range shaded */}
        <div className="hidden md:block relative w-[150px] h-6 shrink-0 cursor-pointer group" title={t('Click to jump')}
          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); }}>
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white/12 group-hover:h-[5px] transition-all overflow-hidden">
            {loopF && <div className="absolute inset-y-0 bg-sky-300/35" style={{ left: `${loopF.a * 100}%`, width: `${(loopF.b - loopF.a) * 100}%` }} />}
            <div ref={progRef} className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#c9974f] to-[#f0d3a0]" style={{ width: '0%' }} />
          </div>
        </div>

        <Divider />

        {/* Tempo (in the settings panel on phones) */}
        <div className="hidden sm:flex items-center shrink-0 rounded-full bg-white/[0.05] h-8" title={t('Speed (quarter notes per minute)')}>
          <button onClick={() => setTempo(v => Math.max(30, v - 4))} aria-label={t('Slower')} className="w-7 h-8 text-white/50 hover:text-white text-[15px]">−</button>
          <span className="text-[12px] w-[46px] text-center"><span className="text-white/45">♩</span> {tempo}</span>
          <button onClick={() => setTempo(v => Math.min(200, v + 4))} aria-label={t('Faster')} className="w-7 h-8 text-white/50 hover:text-white text-[15px]">+</button>
        </div>

        <Divider />

        {/* Practice tools */}
        {canPick && onPickMode && (
          <IconBtn onClick={() => onPickMode(!pickMode)} active={!!pickMode} disabled={!score} label={t('Tap a bar on the score to play from it.')}>
            <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.8-2.4L4.6 16a1.5 1.5 0 0 1 2.3-1.9L9 16" />
          </IconBtn>
        )}
        <IconBtn onClick={toggleLoop} active={looping || !!loopPick} disabled={!score}
          label={loopPick ? t('Cancel') : t('Loop bars: tap the first and last bar on the score')}>
          <path d="M17 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 0 1-4 4H4" />
        </IconBtn>
        <IconBtn onClick={toggleFollow} active={following} tone="rose" disabled={!score}
          label={following ? t('Stop listening') : t('Follow me: the score moves as you play')}>
          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </IconBtn>
        {offNotes.length > 0 && onMarkOffNotes && (
          <button onClick={() => { onMarkOffNotes(offNotes); setOffNotes([]); followerRef.current?.clearOff(); }}
            className="h-8 px-3 rounded-full text-[12px] font-medium bg-[#e8c48a] text-[#1c1812] shrink-0 whitespace-nowrap">
            {t('Mark them on the score')}
          </button>
        )}
        {isHost && onAiMarks && (
          <button onClick={askAi} disabled={!score || aiBusy}
            title={aiMsg || t('AI suggests teaching marks for this score (fingering, shifts, bowing, hard spots)')}
            className="uplay-ai h-8 px-2.5 sm:px-3 rounded-full flex items-center gap-1.5 text-[12px] font-medium shrink-0 disabled:opacity-50 whitespace-nowrap">
            <span aria-hidden className="text-[#e8c48a]">✦</span><span className="hidden sm:inline">{aiBusy ? t('Thinking…') : t('AI marks')}</span>
          </button>
        )}
        <IconBtn onClick={() => setShowMore(v => !v)} active={showMore} label={t('Playback settings')}>
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, label, active, disabled, tone, className = 'flex' }: {
  children: React.ReactNode; onClick: () => void; label: string; active?: boolean; disabled?: boolean; tone?: 'rose'; className?: string;
}) {
  const on = tone === 'rose' ? 'bg-rose-500/90 text-white' : 'bg-[#e8c48a]/15 text-[#f0d3a0] ring-1 ring-[#e8c48a]/40';
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={active}
      className={`${className} w-8 h-8 rounded-full items-center justify-center shrink-0 transition disabled:opacity-35 ${
        active ? on : 'text-white/65 hover:text-white hover:bg-white/[0.08]'}`}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
    </button>
  );
}

function Divider() { return <span aria-hidden className="hidden sm:block w-px h-5 bg-white/10 shrink-0" />; }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</span>
      {children}
    </div>
  );
}

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on} aria-label={label}
      className={`relative w-9 h-5 rounded-full transition shrink-0 ${on ? 'bg-[#e8c48a]' : 'bg-white/15'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}
