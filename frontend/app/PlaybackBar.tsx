'use client';

import { useEffect, useRef, useState } from 'react';
import { useT, useLang } from '../lib/i18n';
import { backendUrl } from '../lib/config';
import { parseMusicXml, type ScoreModel } from '../lib/musicxml';
import { parseMidi } from '../lib/midi';
import { ScorePlayer, soundForPart, type Instrument, type Sound } from '../lib/scorePlayer';
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
        body: JSON.stringify({ hostToken, supabaseToken, instrument: score && effectiveSound(0) === 'violin' ? 'violin' : 'cello', lang }),
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
  // Each part's sound is chosen in the mixer; 'auto' = by the part's name / clef
  const instrument: Instrument = 'auto';
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

  useEffect(() => { playerRef.current?.setTempo(tempo); }, [tempo, score]);

  // ── Parts mixer: each part's sound, mute, solo and volume (what you see is what plays) ──
  const [partSounds, setPartSounds] = useState<Record<number, Sound>>({});
  const [muted, setMuted] = useState<number[]>([]);
  const [solo, setSolo] = useState<number | null>(null);
  const [vols, setVols] = useState<Record<number, number>>({});
  const [activeParts, setActiveParts] = useState<number[]>([]);
  useEffect(() => { setPartSounds({}); setMuted([]); setSolo(null); setVols({}); }, [score]); // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !score) return;
    const n = score.parts?.length ?? 1;
    p.mutedParts = new Set(Array.from({ length: n }, (_, i) => i).filter(i => (solo != null ? i !== solo : muted.includes(i))));
    p.partVolume = vols;
    const changed = JSON.stringify(p.partSounds) !== JSON.stringify(partSounds);
    p.partSounds = partSounds;
    if (changed && p.playing) void p.play(p.currentTime()); // load the new sound and carry on
  }, [partSounds, muted, solo, vols, score]);
  const effectiveSound = (i: number): Sound => partSounds[i] ?? (score ? soundForPart(score, i) : 'piano');
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
  const firstSound = score ? effectiveSound(0) : 'piano';
  const micInstrument = firstSound === 'violin' || firstSound === 'cello' ? firstSound : 'custom';
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
  const [showMix, setShowMix] = useState(false);   // the parts mixer drawer on the bar
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
    if (!playing) { setActiveParts([]); return; } // eslint-disable-line react-hooks/set-state-in-effect
    let raf = 0, lastLight = 0;
    const step = () => {
      const act = playerRef.current?.activeParts();
      if (act && performance.now() - lastLight > 120) {
        lastLight = performance.now();
        const arr = [...act].sort();
        setActiveParts(prev => (prev.join() === arr.join() ? prev : arr));
      }
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

  // eslint-disable-next-line react-hooks/refs -- the Space shortcut always calls the latest toggle
  toggleRef.current = toggle;

  const hasSource = ready || !!imported;
  if (!hasSource && !isHost) return null;
  // Part names for people: the AI reader calls a melody line "Voice", so show the instrument instead
  const parts = (score?.parts ?? []).map((name, i) =>
    score && /^voice\b/i.test(name) ? t(soundForPart(score, i) === 'cello' ? 'Cello' : 'Violin') : name);
  const mismatch = score && barBoxCount && Math.abs(score.bars.length - barBoxCount) > 0
    ? t('This file has {a} bars, the PDF {b}: highlights may be off.', { a: score.bars.length, b: barBoxCount }) : '';
  const fileInput = (
    <input ref={fileRef} type="file" accept=".mid,.midi,.musicxml,.xml,.mxl" className="hidden"
      onChange={e => { const f = e.target.files?.[0]; if (f) uploadScoreFile(f); e.target.value = ''; }} />
  );
  // Teacher, nothing to play yet: just offer to add a file.
  if (!hasSource) {
    return (
      <div className="cp-glass flex items-center gap-2 px-2 py-1.5 rounded-full">
        {fileInput}
        <button onClick={() => fileRef.current?.click()} className="cp-chip">
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

  const nParts = Math.max(1, parts.length);
  const partOff = (i: number) => (solo != null ? solo !== i : muted.includes(i));
  const progressPct = score && total ? 0 : 0; // the line is moved every frame while playing (progRef)

  return (
    <div className="relative" style={{ width: 'min(860px, calc(100vw - 24px))', fontFeatureSettings: '"tnum"' }}>
      {/* Settings: start bar, loop range, tempo on phones, score file */}
      {showMore && (
        <>
          <div className="fixed inset-0 z-[1]" onClick={() => setShowMore(false)} />
          <div className="cp-glass cp-solid cp-pop absolute bottom-full mb-2 right-0 z-[2] w-[300px] max-w-full p-4 rounded-[22px] flex flex-col gap-3.5"
            style={{ transformOrigin: 'bottom right' }}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Start at bar')}>
                <input type="number" min={1} max={total || 999} value={fromBar} aria-label={t('Start at bar')}
                  onChange={e => goToBar(Number(e.target.value))} className="cp-input w-full h-8 text-center text-[13px]" />
              </Field>
              <Field label={t('Loop bars')}>
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={total || 999} value={loopFrom} aria-label={t('Loop from bar')}
                    onChange={e => { setLoopFrom(Math.max(1, Number(e.target.value) || 1)); setLooping(true); }}
                    className="cp-input w-full h-8 text-center text-[13px]" />
                  <span style={{ color: 'var(--cp-ink-3)' }}>–</span>
                  <input type="number" min={1} max={total || 999} value={loopTo} aria-label={t('Loop to bar')}
                    onChange={e => { setLoopTo(Math.max(1, Number(e.target.value) || 1)); setLooping(true); }}
                    className="cp-input w-full h-8 text-center text-[13px]" />
                </div>
              </Field>
            </div>
            {/* On phones the bar only fits the essentials: Follow me and AI live here */}
            <div className="sm:hidden flex gap-2">
              <button onClick={() => { toggleFollow(); setShowMore(false); }} aria-pressed={following} disabled={!score} className="cp-chip cp-rose flex-1 justify-center">
                🎤 {following ? t('Listening') : t('Follow me')}
              </button>
              {isHost && onAiMarks && (
                <button onClick={() => { askAi(); setShowMore(false); }} disabled={!score || aiBusy} className="cp-chip flex-1 justify-center" style={{ boxShadow: 'inset 0 0 0 1px var(--cp-ink)' }}>
                  ✦ {aiBusy ? t('Thinking…') : t('AI marks')}
                </button>
              )}
            </div>
            <div className="sm:hidden">
              <Field label={t('Speed (quarter notes per minute)')}>
                <div className="flex items-center gap-3">
                  <input type="range" min={30} max={200} value={tempo} onChange={e => setTempo(Number(e.target.value))}
                    className="flex-1" style={{ accentColor: 'var(--cp-ink)' }} aria-label={t('Speed (quarter notes per minute)')} />
                  <span className="cp-serif text-[15px] w-12 text-right">♩ {tempo}</span>
                </div>
              </Field>
            </div>
            {isHost && (
              <div className="pt-3" style={{ borderTop: '0.5px solid var(--cp-hair)' }}>
                {fileInput}
                <button onClick={() => (imported ? removeScoreFile() : fileRef.current?.click())}
                  title={imported ? t('Stop using {name}; play the recognized score instead', { name: imported.name }) : t('Add a MusicXML or MIDI file: exact notes for demo or accompaniment')}
                  className="cp-chip w-full justify-center truncate">
                  {imported ? `${imported.name} ✕` : t('Add MusicXML / MIDI file')}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <div className="cp-glass rounded-[28px] p-1.5">
        <div className="flex items-center justify-between gap-1.5 sm:gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <button onClick={() => goToBar(fromBar)} disabled={!score} title={t('Back to bar {n}', { n: fromBar })} aria-label={t('Back to bar {n}', { n: fromBar })}
            className="cp-btn w-9 h-9 rounded-full hidden sm:flex q-bottom-extra">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6 5v14M18 6l-9 6 9 6z" /><rect x="5" y="5" width="2" height="14" rx="1" /></svg>
          </button>

          {/* Play / pause */}
          <button onClick={toggle} disabled={!score}
            title={playing ? t('Pause') + ' (Space)' : t('Play the score') + ' (Space)'}
            aria-label={playing ? t('Pause') : t('Play the score')}
            className="w-11 h-11 rounded-full grid place-items-center shrink-0 disabled:opacity-40 transition-transform active:scale-90"
            style={{ background: 'var(--cp-ink)', color: 'var(--cp-paper)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25), 0 8px 20px -8px rgba(0,0,0,.45)' }}>
            <span key={playing ? 'pa' : 'pl'} className="cp-pop grid place-items-center">
              {playing
                ? <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.3" /><rect x="13.8" y="5" width="4.2" height="14" rx="1.3" /></svg>
                : <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M8.5 5.5v13a.8.8 0 0 0 1.2.7l10.2-6.5a.8.8 0 0 0 0-1.4L9.7 4.8a.8.8 0 0 0-1.2.7z" /></svg>}
            </span>
          </button>

          {/* Bar counter + what's happening */}
          <div className="flex flex-col justify-center shrink-0 w-[96px] sm:w-[128px] pl-1">
            <div className="flex items-baseline gap-1.5 leading-none">
              <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--cp-live)' }}>{t('Bar')}</span>
              <span key={shownBar} className="cp-serif cp-pop text-[19px] tracking-tight">{shownBar}</span>
              {total > 0 && <span className="text-[11px]" style={{ color: 'var(--cp-ink-3)' }}>/ {total}</span>}
            </div>
            <span className="text-[10.5px] leading-tight mt-1 truncate" style={{ color: 'var(--cp-ink-2)' }} title={caption || title}>{caption || title}</span>
          </div>

          {/* Progress through the piece (click to jump); loop range shaded */}
          <div className="hidden xl:block relative flex-1 min-w-[80px] h-7 cursor-pointer group q-bottom-extra" title={t('Click to jump')}
            onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); }}>
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] group-hover:h-[5px] rounded-full overflow-hidden transition-all" style={{ background: 'var(--cp-wash)' }}>
              {loopF && <div className="absolute inset-y-0" style={{ left: `${loopF.a * 100}%`, width: `${(loopF.b - loopF.a) * 100}%`, background: 'rgba(80,150,220,.35)' }} />}
              <div ref={progRef} className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${progressPct}%`, background: 'var(--cp-ink)' }} />
            </div>
          </div>

          {/* Tempo */}
          <div className="hidden sm:flex items-center shrink-0 rounded-full h-9 q-bottom-extra" style={{ background: 'var(--cp-wash)' }} title={t('Speed (quarter notes per minute)')}>
            <button onClick={() => setTempo(v => Math.max(30, v - 4))} aria-label={t('Slower')} className="w-8 h-9 text-[16px] rounded-full transition-transform active:scale-90" style={{ color: 'var(--cp-ink-2)' }}>−</button>
            <span className="cp-serif text-[15px] min-w-[46px] text-center"><span style={{ color: 'var(--cp-ink-3)' }}>♩</span> {tempo}</span>
            <button onClick={() => setTempo(v => Math.min(200, v + 4))} aria-label={t('Faster')} className="w-8 h-9 text-[16px] rounded-full transition-transform active:scale-90" style={{ color: 'var(--cp-ink-2)' }}>+</button>
          </div>

          {/* Practice tools: always visible, with words */}
          <div className="flex items-center gap-1.5 shrink-0 q-bottom-extra">
            {canPick && onPickMode && (
              <button onClick={() => onPickMode(!pickMode)} aria-pressed={!!pickMode} disabled={!score} className="cp-chip" title={t('Tap a bar on the score to play from it.')}>
                <ChipIcon><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.8-2.4L4.6 16a1.5 1.5 0 0 1 2.3-1.9L9 16" /></ChipIcon>
                <span className="hidden xl:inline">{t('Tap to play')}</span>
              </button>
            )}
            <button onClick={toggleLoop} aria-pressed={looping || !!loopPick} disabled={!score} className="cp-chip"
              title={loopPick ? t('Cancel') : t('Loop bars: tap the first and last bar on the score')}>
              <ChipIcon><path d="M17 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 0 1-4 4H4" /></ChipIcon>
              <span className="hidden xl:inline">{loopPick ? t('Cancel') : t('Loop')}</span>
            </button>
            <button onClick={() => setCountIn(c => !c)} aria-pressed={countIn} disabled={!score} className="cp-chip hidden sm:flex" title={t('One bar of clicks before playing')}>
              <ChipIcon><path d="M12 22V8M5 22h14M9 8h6M12 4v4M8.5 15.5 12 8l3.5 7.5" /></ChipIcon>
              <span className="hidden xl:inline">{t('Count-in')}</span>
            </button>
            <button onClick={toggleFollow} aria-pressed={following} disabled={!score} className="cp-chip cp-rose hidden sm:flex"
              title={following ? t('Stop listening') : t('Follow me: the score moves as you play')}>
              <ChipIcon><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></ChipIcon>
              <span className="hidden xl:inline">{following ? t('Listening') : t('Follow me')}</span>
            </button>
          </div>

          {/* Parts: a light per part shows who is playing; opens the mixer */}
          <button onClick={() => setShowMix(v => !v)} aria-expanded={showMix} aria-pressed={showMix} disabled={!score}
            className="cp-chip q-bottom-extra" title={t('Parts: sound, mute, solo, volume')}>
            {Array.from({ length: nParts }, (_, i) => (
              <span key={i} className="w-2 h-2 rounded-full transition-all" style={{
                background: activeParts.includes(i) && !partOff(i) ? 'var(--cp-live)' : partOff(i) ? 'transparent' : 'var(--cp-ink-3)',
                boxShadow: activeParts.includes(i) && !partOff(i) ? '0 0 8px var(--cp-live)' : partOff(i) ? 'inset 0 0 0 1px var(--cp-ink-3)' : 'none' }} />
            ))}
            <span className="hidden lg:inline">{t('Parts')}</span>
          </button>

          {offNotes.length > 0 && onMarkOffNotes && (
            <button onClick={() => { onMarkOffNotes(offNotes); setOffNotes([]); followerRef.current?.clearOff(); }} className="cp-chip" style={{ color: 'var(--cp-live)' }}>
              {t('Mark them on the score')}
            </button>
          )}
          {isHost && onAiMarks && (
            <button onClick={askAi} disabled={!score || aiBusy} className="cp-chip q-bottom-extra hidden sm:flex" style={{ boxShadow: 'inset 0 0 0 1px var(--cp-ink)' }}
              title={aiMsg || t('AI suggests teaching marks for this score (fingering, shifts, bowing, hard spots)')}>
              <span aria-hidden>✦</span><span className="hidden lg:inline">{aiBusy ? t('Thinking…') : t('AI marks')}</span>
            </button>
          )}
          <button onClick={() => setShowMore(v => !v)} aria-pressed={showMore} title={t('Playback settings')} aria-label={t('Playback settings')}
            className="cp-btn w-9 h-9 rounded-full q-bottom-extra">
            <ChipIcon><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></ChipIcon>
          </button>
        </div>

        {/* Mixer drawer: one row per part — what you set here is exactly what plays */}
        <div className="grid transition-all duration-500" style={{ gridTemplateRows: showMix ? '1fr' : '0fr', opacity: showMix ? 1 : 0,
          transitionTimingFunction: 'var(--cp-spring)' }}>
          <div className="overflow-hidden">
            <div className="flex flex-col gap-1.5 px-1 pt-2 pb-1">
              {(parts.length ? parts : [t('Score')]).map((name, i) => (
                <div key={i} className="flex items-center gap-2 sm:gap-3 rounded-[18px] px-3 py-2 transition-opacity"
                  style={{ background: 'var(--cp-wash)', opacity: partOff(i) ? 0.5 : 1 }}>
                  <span className="w-2 h-2 rounded-full shrink-0 transition-all" title={t('Playing now')} style={{
                    background: activeParts.includes(i) && !partOff(i) ? 'var(--cp-live)' : 'var(--cp-hair)',
                    boxShadow: activeParts.includes(i) && !partOff(i) ? '0 0 8px var(--cp-live)' : 'none' }} />
                  <span className="cp-serif text-[15px] min-w-[64px] truncate" title={name}>{name}</span>
                  <Segmented value={effectiveSound(i)} label={t('Sound for {part}', { part: name })}
                    options={[['piano', t('Piano')], ['violin', t('Violin')], ['cello', t('Cello')]]}
                    onChange={v => setPartSounds(ps => ({ ...ps, [i]: v as Sound }))} />
                  <button onClick={() => setMuted(m => (m.includes(i) ? m.filter(x => x !== i) : [...m, i]))} aria-pressed={muted.includes(i)}
                    title={t('Mute {part} (e.g. the student plays it)', { part: name })}
                    className="w-8 h-8 rounded-[10px] text-[12px] font-semibold shrink-0 transition-all active:scale-90"
                    style={muted.includes(i) ? { background: '#e5484d', color: '#fff' } : { background: 'var(--cp-wash)', color: 'var(--cp-ink-2)' }}>M</button>
                  {parts.length > 1 && (
                    <button onClick={() => setSolo(s => (s === i ? null : i))} aria-pressed={solo === i} title={t('Only {part}', { part: name })}
                      className="w-8 h-8 rounded-[10px] text-[12px] font-semibold shrink-0 transition-all active:scale-90"
                      style={solo === i ? { background: 'var(--cp-ink)', color: 'var(--cp-paper)' } : { background: 'var(--cp-wash)', color: 'var(--cp-ink-2)' }}>S</button>
                  )}
                  <input type="range" min={0} max={150} value={Math.round((vols[i] ?? 1) * 100)} aria-label={t('Volume of {part}', { part: name })}
                    onChange={e => setVols(v => ({ ...v, [i]: Number(e.target.value) / 100 }))}
                    className="flex-1 min-w-[60px]" style={{ accentColor: 'var(--cp-ink)' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChipIcon({ children }: { children: React.ReactNode }) {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">{children}</svg>;
}

/** Segmented control with a sliding selected block (Apple style). */
function Segmented({ value, options, onChange, label }: { value: string; options: [string, string][]; onChange: (v: string) => void; label: string }) {
  const idx = Math.max(0, options.findIndex(o => o[0] === value));
  return (
    <div role="radiogroup" aria-label={label} className="relative grid p-[3px] rounded-[11px] shrink-0"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)`, background: 'var(--cp-wash)' }}>
      <span className="absolute top-[3px] bottom-[3px] rounded-[8px]" style={{
        left: 3, width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${idx * 100}%)`,
        background: 'var(--cp-glass-strong)', boxShadow: '0 1px 3px rgba(0,0,0,.14)', transition: 'transform .45s var(--cp-spring)' }} />
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={v === value} onClick={() => onChange(v)}
          className="relative h-7 px-2.5 text-[12px] rounded-[8px] transition-colors"
          style={{ color: v === value ? 'var(--cp-ink)' : 'var(--cp-ink-2)', fontWeight: v === value ? 500 : 400 }}>{l}</button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="cp-label">{label}</span>
      {children}
    </div>
  );
}
