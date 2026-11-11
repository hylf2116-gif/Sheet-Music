'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useT, useLang } from '../lib/i18n';

// ─── Types ───────────────────────────────────────────────────────────────────

type AccentLevel = 0 | 1 | 2;
type SoundType = 'classic' | 'woodblock' | 'cowbell' | 'rimshot' | 'hihat' | 'beep';
type TrainerMode = 'off' | 'gradual' | 'random' | 'target';
type TimerMode = 'off' | 'time' | 'bars';

export type MetronomeState = {
  bpm: number;
  isPlaying: boolean;
  beatsPerBar: number;
  subdivision: number;
  startTime: number;
  denominator?: number;
  accents?: AccentLevel[];
  soundType?: string;
};

type Preset = {
  id: string;
  name: string;
  bpm: number;
  beatsPerBar: number;
  denominator: number;
  subdivision: number;
  accents: AccentLevel[];
  soundType: SoundType;
};

interface Props {
  isHost: boolean;
  roomId: string | null;
  remoteState: MetronomeState | null;
  onUpdate: (state: MetronomeState) => void;
  onClose: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TEMPO_MARKINGS = [
  { name: 'Larghissimo', range: '< 24',    min: 0,   max: 24,  bpm: 20  },
  { name: 'Grave',       range: '24–40',   min: 24,  max: 40,  bpm: 32  },
  { name: 'Largo',       range: '40–60',   min: 40,  max: 60,  bpm: 50  },
  { name: 'Larghetto',   range: '60–66',   min: 60,  max: 66,  bpm: 63  },
  { name: 'Adagio',      range: '66–76',   min: 66,  max: 76,  bpm: 71  },
  { name: 'Andante',     range: '76–108',  min: 76,  max: 108, bpm: 92  },
  { name: 'Moderato',    range: '108–120', min: 108, max: 120, bpm: 114 },
  { name: 'Allegretto',  range: '112–120', min: 112, max: 120, bpm: 116 },
  { name: 'Allegro',     range: '120–156', min: 120, max: 156, bpm: 138 },
  { name: 'Vivace',      range: '156–176', min: 156, max: 176, bpm: 166 },
  { name: 'Presto',      range: '176–200', min: 176, max: 200, bpm: 188 },
  { name: 'Prestissimo', range: '> 200',   min: 200, max: 999, bpm: 220 },
];

const TIME_SIG_PRESETS = [
  { n: 2, d: 4 }, { n: 3, d: 4 }, { n: 4, d: 4 }, { n: 5, d: 4 },
  { n: 6, d: 8 }, { n: 7, d: 8 }, { n: 9, d: 8 }, { n: 12, d: 8 },
];

const SOUND_TYPES: { id: SoundType; label: string }[] = [
  { id: 'classic',   label: 'Click'   },
  { id: 'woodblock', label: 'Wood'    },
  { id: 'cowbell',   label: 'Cowbell' },
  { id: 'rimshot',   label: 'Rimshot' },
  { id: 'hihat',     label: 'Hi-hat'  },
  { id: 'beep',      label: 'Beep'    },
];

const SUBDIV_OPTIONS = [
  { value: 1, label: '1', name: 'None'     },
  { value: 2, label: '2', name: 'Duplets'  },
  { value: 3, label: '3', name: 'Triplets' },
  { value: 4, label: '4', name: '16ths'    },
];

const STORAGE_KEY = 'unino_metro_presets_v2';

// Safe expression evaluator — only digits, operators, decimals, parens.
// Prefix-operator shorthand: "+10" → currentBpm + 10, "*2" → currentBpm * 2
function evalBpmExpr(raw: string, currentBpm: number): number | null {
  const s = raw.trim();
  if (!s) return null;
  const expr = /^[+\-*/]/.test(s) ? `${currentBpm}${s}` : s;
  if (!/^[\d\s+\-*/.()\s]+$/.test(expr)) return null;
  try {
    const result = new Function(`return (${expr})`)();
    if (typeof result === 'number' && isFinite(result)) return Math.round(result * 10) / 10;
  } catch {}
  return null;
}

// ─── Audio synthesis ─────────────────────────────────────────────────────────

function playClassic(ctx: AudioContext, freq: number, gain: number, when: number) {
  const osc = ctx.createOscillator(), env = ctx.createGain();
  osc.type = 'sine'; osc.frequency.value = freq;
  env.gain.setValueAtTime(gain, when);
  env.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
  osc.connect(env); env.connect(ctx.destination);
  osc.start(when); osc.stop(when + 0.05);
}

function playWoodblock(ctx: AudioContext, freq: number, gain: number, when: number) {
  const len = Math.floor(ctx.sampleRate * 0.06);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 8;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain * 1.5, when);
  env.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
  src.connect(bp); bp.connect(env); env.connect(ctx.destination);
  src.start(when);
}

function playCowbell(ctx: AudioContext, gain: number, when: number) {
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), env = ctx.createGain();
  o1.type = 'square'; o1.frequency.value = 587;
  o2.type = 'square'; o2.frequency.value = 845;
  env.gain.setValueAtTime(gain * 0.4, when);
  env.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
  o1.connect(env); o2.connect(env); env.connect(ctx.destination);
  o1.start(when); o1.stop(when + 0.35);
  o2.start(when); o2.stop(when + 0.35);
}

function playRimshot(ctx: AudioContext, gain: number, when: number) {
  const len = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const nEnv = ctx.createGain();
  nEnv.gain.setValueAtTime(gain * 0.7, when);
  nEnv.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
  const osc = ctx.createOscillator(), oEnv = ctx.createGain();
  osc.frequency.value = 250;
  oEnv.gain.setValueAtTime(gain * 0.5, when);
  oEnv.gain.exponentialRampToValueAtTime(0.001, when + 0.03);
  src.connect(nEnv); nEnv.connect(ctx.destination);
  osc.connect(oEnv); oEnv.connect(ctx.destination);
  src.start(when); osc.start(when); osc.stop(when + 0.05);
}

function playHihat(ctx: AudioContext, gain: number, when: number) {
  const len = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain * 0.6, when);
  env.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
  src.connect(hp); hp.connect(env); env.connect(ctx.destination);
  src.start(when);
}

function playBeep(ctx: AudioContext, freq: number, gain: number, when: number) {
  const osc = ctx.createOscillator(), env = ctx.createGain();
  osc.type = 'sine'; osc.frequency.value = freq;
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(gain, when + 0.005);
  env.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
  osc.connect(env); env.connect(ctx.destination);
  osc.start(when); osc.stop(when + 0.15);
}

function playSound(ctx: AudioContext, type: SoundType, freq: number, gain: number, when: number) {
  if (gain < 0.001) return;
  switch (type) {
    case 'classic':   playClassic(ctx, freq, gain, when); break;
    case 'woodblock': playWoodblock(ctx, freq, gain, when); break;
    case 'cowbell':   playCowbell(ctx, gain, when); break;
    case 'rimshot':   playRimshot(ctx, gain, when); break;
    case 'hihat':     playHihat(ctx, gain, when); break;
    case 'beep':      playBeep(ctx, freq, gain, when); break;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

// Collapsible section header. Defined at module level so React keeps it stable between renders.
function SectionHeader({ title, isOpen, onToggle }: { title: string; isOpen: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <button onClick={onToggle} className="w-full flex items-center justify-between py-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t(title)}</span>
      <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>
    </button>
  );
}

export default function MetronomePanel({ isHost, remoteState, onUpdate, onClose }: Props) {
  const t = useT();
  const { lang } = useLang();
  // BPM
  const [bpm, setBpm] = useState(120);
  const [bpmEditing, setBpmEditing] = useState(false);
  const [bpmInput, setBpmInput] = useState('120');
  const [bpmPreview, setBpmPreview] = useState<number | null>(null);
  const [showTempoDD, setShowTempoDD] = useState(false);
  const bpmInputRef = useRef<HTMLInputElement>(null);

  // Time sig
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [denominator, setDenominator] = useState(4);

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [flash, setFlash] = useState(false);
  const [panelFlash, setPanelFlash] = useState(false);

  // Sound
  const [soundType, setSoundType] = useState<SoundType>('classic');
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [accentPitch, setAccentPitch] = useState(1800);
  const [normalPitch, setNormalPitch] = useState(900);

  // Subdivision
  const [subdivision, setSubdivision] = useState(1);

  // Accents
  const [accents, setAccents] = useState<AccentLevel[]>(() => Array(16).fill(0).map((_, i) => i === 0 ? 2 : 0) as AccentLevel[]);
  const accentDragging = useRef(false);
  const accentDragValue = useRef<AccentLevel>(1);

  // Trainer
  const [trainerMode, setTrainerMode] = useState<TrainerMode>('off');
  const [trainerAmount, setTrainerAmount] = useState(2);
  const [trainerEvery, setTrainerEvery] = useState(4);
  const [trainerTargetBpm, setTrainerTargetBpm] = useState(160);
  const [trainerMinutes, setTrainerMinutes] = useState(5);
  const [trainerStartBpm, setTrainerStartBpm] = useState(120);
  const trainerBarCount = useRef(0);
  const trainerBarIndex = useRef(0);

  // Timer
  const [timerMode, setTimerMode] = useState<TimerMode>('off');
  const [timerMinutes, setTimerMinutes] = useState(5);
  const [timerBars, setTimerBars] = useState(32);
  const [timerRemaining, setTimerRemaining] = useState<string | null>(null);
  const timerBarCount = useRef(0);

  // Presets
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState('');

  // Visual
  const [showPendulum, setShowPendulum] = useState(true);
  const [showFlash, setShowFlash] = useState(true);
  const [showDots, setShowDots] = useState(true);

  // Layout
  const [minimized, setMinimized] = useState(false);
  const [panelPos, setPanelPos] = useState({ x: -1, y: -1 }); // -1 = not yet placed
  const [panelSize, setPanelSize] = useState({ w: 360, h: 540 });
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Returns how many CSS-layout pixels correspond to one viewport pixel.
  // = 1 for browser zoom; = 1/cssZoom when a parent has CSS zoom applied.
  function layoutScale() {
    const rect = panelRef.current?.getBoundingClientRect();
    return rect ? panelSize.w / rect.width : 1;
  }

  // Sections
  const [open, setOpen] = useState({ tempo: true, timesig: true, sound: false, accents: true, trainer: false, presets: false, timer: false });
  const toggleOpen = (k: keyof typeof open) => setOpen(p => ({ ...p, [k]: !p[k] }));

  // Audio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const schedulerRef = useRef<number | null>(null);
  const nextBeatTimeRef = useRef(0);
  const beatIndexRef = useRef(0);
  const muteBarRef = useRef(false);

  // Scheduler refs (all state readable from scheduler without stale closures)
  const R = useRef({
    bpm: 120, beatsPerBar: 4, subdivision: 1, accents: accents,
    volume: 0.8, muted: false, soundType: 'classic' as SoundType,
    accentPitch: 1800, normalPitch: 900,
    isHost: isHost,
    trainerMode: 'off' as TrainerMode, trainerAmount: 2, trainerEvery: 4,
    trainerTargetBpm: 160, trainerMinutes: 5, trainerStartBpm: 120,
    timerMode: 'off' as TimerMode, timerMinutes: 5, timerBars: 32,
  });

  // Sync all state into R
  useEffect(() => { R.current.bpm = bpm; }, [bpm]);
  useEffect(() => { R.current.beatsPerBar = beatsPerBar; }, [beatsPerBar]);
  useEffect(() => { R.current.subdivision = subdivision; }, [subdivision]);
  useEffect(() => { R.current.accents = accents; }, [accents]);
  useEffect(() => { R.current.volume = volume; }, [volume]);
  useEffect(() => { R.current.muted = muted; }, [muted]);
  useEffect(() => { R.current.soundType = soundType; }, [soundType]);
  useEffect(() => { R.current.accentPitch = accentPitch; }, [accentPitch]);
  useEffect(() => { R.current.normalPitch = normalPitch; }, [normalPitch]);
  useEffect(() => { R.current.isHost = isHost; }, [isHost]);
  useEffect(() => { R.current.trainerMode = trainerMode; }, [trainerMode]);
  useEffect(() => { R.current.trainerAmount = trainerAmount; }, [trainerAmount]);
  useEffect(() => { R.current.trainerEvery = trainerEvery; }, [trainerEvery]);
  useEffect(() => { R.current.trainerTargetBpm = trainerTargetBpm; }, [trainerTargetBpm]);
  useEffect(() => { R.current.trainerMinutes = trainerMinutes; }, [trainerMinutes]);
  useEffect(() => { R.current.trainerStartBpm = trainerStartBpm; }, [trainerStartBpm]);
  useEffect(() => { R.current.timerMode = timerMode; }, [timerMode]);
  useEffect(() => { R.current.timerMinutes = timerMinutes; }, [timerMinutes]);
  useEffect(() => { R.current.timerBars = timerBars; }, [timerBars]);

  // Stable function refs
  const stopRef = useRef<() => void>(() => {});
  const changeBpmFnRef = useRef<(v: number) => void>(() => {});
  const emitRef = useRef<(o?: Partial<MetronomeState>) => void>(() => {});
  const scheduleRef = useRef<() => void>(() => {});

  // Load presets
  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load saved presets after mount (localStorage is not available during server render)
      if (s) setPresets(JSON.parse(s));
    } catch {}
  }, []);

  // Remote state (participants only)
  useEffect(() => {
    if (isHost || !remoteState) return;
    const s = remoteState;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- apply the host's metronome state received over the socket
    setBpm(s.bpm); R.current.bpm = s.bpm;
    if (s.beatsPerBar) { setBeatsPerBar(s.beatsPerBar); R.current.beatsPerBar = s.beatsPerBar; }
    if (s.denominator) setDenominator(s.denominator);
    if (s.subdivision) { setSubdivision(s.subdivision); R.current.subdivision = s.subdivision; }
    if (s.accents) { setAccents(s.accents); R.current.accents = s.accents; }
    if (s.soundType) { setSoundType(s.soundType as SoundType); R.current.soundType = s.soundType as SoundType; }
    if (s.isPlaying && !isPlaying) startPlayback(s.startTime);
    if (!s.isPlaying && isPlaying) stopRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteState]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isHost) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlayRef.current(); }
      else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        const dir = e.code === 'ArrowUp' ? 1 : -1;
        const step = (e.ctrlKey || e.metaKey) ? 10 : e.shiftKey ? 5 : 1;
        changeBpmFnRef.current(R.current.bpm + dir * step);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isHost]);

  // Cleanup on unmount
  useEffect(() => () => { stopRef.current(); audioCtxRef.current?.close(); }, []);

  // ── Audio ──────────────────────────────────────────────────────────────────

  function getCtx() {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    return audioCtxRef.current;
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────

  const scheduleBeats = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const window_ = ctx.currentTime + 0.1; // 100ms lookahead

    while (nextBeatTimeRef.current < window_) {
      const r = R.current;
      const absIdx = beatIndexRef.current;
      const totalSub = r.beatsPerBar * r.subdivision;
      const beatInBar = Math.floor(absIdx / r.subdivision) % r.beatsPerBar;
      const subInBeat = absIdx % r.subdivision;
      const barIdx = Math.floor(absIdx / totalSub);
      const isBarStart = absIdx % totalSub === 0 && absIdx > 0;

      // Decide muting for random trainer at bar boundary (in scheduler, before scheduling sounds)
      if (isBarStart && r.trainerMode === 'random') {
        muteBarRef.current = Math.random() < 1 / Math.max(1, r.trainerEvery);
      }

      // Schedule sound
      const isBeat = subInBeat === 0;
      if (!r.muted && !muteBarRef.current) {
        if (isBeat) {
          const accentLevel = r.accents[beatInBar] ?? 0;
          const freq = accentLevel === 2 ? r.accentPitch
            : accentLevel === 1 ? r.normalPitch * 1.2
            : r.normalPitch;
          const g = accentLevel === 2 ? 1.0
            : accentLevel === 1 ? 0.55
            : 0.4;
          playSound(ctx, r.soundType, freq, r.volume * g, nextBeatTimeRef.current);
        } else if (r.subdivision > 1) {
          playSound(ctx, r.soundType, r.normalPitch * 0.55, r.volume * 0.2, nextBeatTimeRef.current);
        }
      }

      // Schedule UI update
      const when = nextBeatTimeRef.current;
      const delay = Math.max(0, (when - ctx.currentTime) * 1000);
      const capBeat = beatInBar;
      const capBarIdx = barIdx;
      const capIsBarStart = isBarStart;
      setTimeout(() => {
        setCurrentBeat(capBeat);
        if (isBeat) {
          setFlash(true);
          setTimeout(() => setFlash(false), 80);
          if (capBeat === 0) {
            setPanelFlash(true);
            setTimeout(() => setPanelFlash(false), 120);
          }
        }

        if (capIsBarStart) {
          trainerBarIndex.current = capBarIdx;

          if (r.trainerMode === 'gradual' && R.current.isHost) {
            trainerBarCount.current += 1;
            if (trainerBarCount.current >= R.current.trainerEvery) {
              trainerBarCount.current = 0;
              const next = Math.min(300, Math.round((R.current.bpm + R.current.trainerAmount) * 10) / 10);
              setBpm(next); R.current.bpm = next;
              setBpmInput(String(next));
              if (schedulerRef.current) clearTimeout(schedulerRef.current);
              if (audioCtxRef.current) nextBeatTimeRef.current = audioCtxRef.current.currentTime + 0.05;
              scheduleRef.current();
              emitRef.current({ bpm: next });
            }
          } else if (r.trainerMode === 'target' && R.current.isHost) {
            const totalBars = (R.current.trainerMinutes * 60) / ((60 / R.current.bpm) * R.current.beatsPerBar);
            const frac = Math.min(1, capBarIdx / Math.max(1, totalBars));
            const next = Math.round((R.current.trainerStartBpm + (R.current.trainerTargetBpm - R.current.trainerStartBpm) * frac) * 10) / 10;
            if (Math.abs(next - R.current.bpm) >= 0.1) {
              setBpm(next); R.current.bpm = next;
              setBpmInput(String(next));
              if (schedulerRef.current) clearTimeout(schedulerRef.current);
              if (audioCtxRef.current) nextBeatTimeRef.current = audioCtxRef.current.currentTime + 0.05;
              scheduleRef.current();
              emitRef.current({ bpm: next });
            }
            if (frac >= 1) stopRef.current();
          }

          // Timer
          if (R.current.timerMode === 'bars') {
            timerBarCount.current += 1;
            const rem = R.current.timerBars - timerBarCount.current;
            setTimerRemaining(rem <= 0 ? null : `${rem} bars`);
            if (rem <= 0) stopRef.current();
          } else if (R.current.timerMode === 'time') {
            const elapsedS = capBarIdx * R.current.beatsPerBar * (60 / R.current.bpm);
            const remS = Math.max(0, R.current.timerMinutes * 60 - elapsedS);
            if (remS <= 0) { stopRef.current(); setTimerRemaining(null); }
            else setTimerRemaining(`${Math.floor(remS / 60)}:${String(Math.floor(remS % 60)).padStart(2, '0')}`);
          }
        }
      }, delay);

      beatIndexRef.current += 1;
      nextBeatTimeRef.current += 60 / (R.current.bpm * R.current.subdivision);
    }

    schedulerRef.current = window.setTimeout(scheduleBeats, 25);
  // useCallback with [] — reads all state via R ref
   
  }, []);

  scheduleRef.current = scheduleBeats;

  // ── Playback ───────────────────────────────────────────────────────────────

  function stopPlayback() {
    if (schedulerRef.current) { clearTimeout(schedulerRef.current); schedulerRef.current = null; }
    setIsPlaying(false);
    setCurrentBeat(-1);
    setFlash(false);
    setPanelFlash(false);
    setTimerRemaining(null);
    muteBarRef.current = false;
  }
  stopRef.current = stopPlayback;

  function startPlayback(remoteStartTime?: number) {
    const ctx = getCtx();
    beatIndexRef.current = 0;
    trainerBarCount.current = 0;
    trainerBarIndex.current = 0;
    timerBarCount.current = 0;
    muteBarRef.current = false;

    if (R.current.trainerMode === 'target') {
      setTrainerStartBpm(R.current.bpm);
      R.current.trainerStartBpm = R.current.bpm;
    }

    if (remoteStartTime != null) {
      const elapsed = (Date.now() - remoteStartTime) / 1000;
      const subDur = 60 / (R.current.bpm * R.current.subdivision);
      const skipped = Math.floor(elapsed / subDur);
      beatIndexRef.current = skipped;
      nextBeatTimeRef.current = ctx.currentTime + ((skipped + 1) * subDur - elapsed);
    } else {
      nextBeatTimeRef.current = ctx.currentTime + 0.05;
    }

    scheduleBeats();
    setIsPlaying(true);
    setCurrentBeat(0);
  }

  const togglePlayRef = useRef(() => {});
  function togglePlay() {
    if (!isHost) return;
    if (isPlaying) {
      stopPlayback();
      emitRef.current({ isPlaying: false });
    } else {
      startPlayback();
      emitRef.current({ isPlaying: true, startTime: Date.now() });
    }
  }
  togglePlayRef.current = togglePlay;

  function emitUpdate(overrides?: Partial<MetronomeState>) {
    if (!isHost) return;
    onUpdate({
      bpm: R.current.bpm, isPlaying, beatsPerBar: R.current.beatsPerBar,
      denominator, subdivision: R.current.subdivision,
      accents: R.current.accents, soundType: R.current.soundType,
      startTime: Date.now(), ...overrides,
    });
  }
  emitRef.current = emitUpdate;

  function changeBpm(next: number) {
    const v = Math.max(20, Math.min(300, Math.round(next * 10) / 10));
    setBpm(v); R.current.bpm = v;
    setBpmInput(String(v));
    if (isPlaying) {
      if (schedulerRef.current) clearTimeout(schedulerRef.current);
      if (audioCtxRef.current) nextBeatTimeRef.current = audioCtxRef.current.currentTime + 0.05;
      scheduleBeats();
    }
    if (isHost) emitRef.current({ bpm: v });
  }
  changeBpmFnRef.current = changeBpm;

  // ── Tap tempo ─────────────────────────────────────────────────────────────

  const tapTimes = useRef<number[]>([]);
  function tap() {
    if (!isHost) return;
    const now = performance.now();
    if (tapTimes.current.length > 0 && now - tapTimes.current[tapTimes.current.length - 1] > 3000) tapTimes.current = [];
    tapTimes.current.push(now);
    if (tapTimes.current.length > 8) tapTimes.current.splice(0, tapTimes.current.length - 8);
    if (tapTimes.current.length >= 2) {
      const intervals = tapTimes.current.slice(1).map((t, i) => t - tapTimes.current[i]);
      changeBpm(60000 / (intervals.reduce((a, b) => a + b) / intervals.length));
    }
  }

  // ── Initialize position + re-clamp on viewport change (zoom / resize) ──────

  useEffect(() => {
    if (panelPos.x === -1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- position needs window size, only known after mount
      setPanelPos({
        x: Math.max(0, window.innerWidth - panelSize.w - 24),
        y: Math.max(0, window.innerHeight - panelSize.h - 80),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function clamp() {
      setPanelPos(prev => {
        if (prev.x < 0) return prev;
        return {
          x: Math.max(0, Math.min(window.innerWidth - panelSize.w, prev.x)),
          y: Math.max(0, Math.min(window.innerHeight - 48, prev.y)),
        };
      });
    }
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [panelSize.w]);

  // ── Drag header ───────────────────────────────────────────────────────────

  function onHeaderMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const scale = layoutScale(); // viewport-px → layout-px conversion
    const startX = e.clientX, startY = e.clientY;
    const startPX = panelPos.x, startPY = panelPos.y;
    setIsDragging(true);
    function onMove(ev: MouseEvent) {
      const maxX = window.innerWidth * scale - panelSize.w;
      const maxY = window.innerHeight * scale - 48;
      setPanelPos({
        x: Math.max(0, Math.min(maxX, startPX + (ev.clientX - startX) * scale)),
        y: Math.max(0, Math.min(maxY, startPY + (ev.clientY - startY) * scale)),
      });
    }
    function onUp() {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Resize (all edges/corners) ────────────────────────────────────────────

  type ResizeDir = { l?: true; r?: true; t?: true; b?: true };
  function startResize(e: React.MouseEvent, dir: ResizeDir) {
    e.preventDefault();
    e.stopPropagation();
    const scale = layoutScale();
    const sx = e.clientX, sy = e.clientY;
    const sw = panelSize.w, sh = panelSize.h;
    const spx = panelPos.x, spy = panelPos.y;
    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - sx) * scale;
      const dy = (ev.clientY - sy) * scale;
      let w = sw, h = sh, x = spx, y = spy;
      const maxH = window.innerHeight * scale - 60;
      if (dir.r) w = Math.max(280, Math.min(700, sw + dx));
      if (dir.l) { w = Math.max(280, Math.min(700, sw - dx)); x = spx + (sw - w); }
      if (dir.b) h = Math.max(300, Math.min(maxH, sh + dy));
      if (dir.t) { h = Math.max(300, Math.min(maxH, sh - dy)); y = spy + (sh - h); }
      setPanelSize({ w, h });
      setPanelPos({ x, y });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Presets ───────────────────────────────────────────────────────────────

  function savePreset() {
    if (!presetName.trim()) return;
    const p: Preset = {
      id: crypto.randomUUID(), name: presetName.trim(),
      bpm, beatsPerBar, denominator, subdivision,
      accents: [...accents] as AccentLevel[], soundType,
    };
    const next = [...presets, p];
    setPresets(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    setPresetName('');
  }

  function loadPreset(p: Preset) {
    changeBpm(p.bpm);
    setBeatsPerBar(p.beatsPerBar); R.current.beatsPerBar = p.beatsPerBar;
    setDenominator(p.denominator);
    setSubdivision(p.subdivision); R.current.subdivision = p.subdivision;
    setAccents(p.accents as AccentLevel[]); R.current.accents = p.accents as AccentLevel[];
    setSoundType(p.soundType); R.current.soundType = p.soundType;
    if (isHost) emitRef.current({});
  }

  function deletePreset(id: string) {
    const next = presets.filter(p => p.id !== id);
    setPresets(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  const tempoMarking = TEMPO_MARKINGS.findLast(t => bpm >= t.min)?.name ?? 'Larghissimo';
  const pendulumAngle = currentBeat >= 0 ? (currentBeat / Math.max(beatsPerBar - 1, 1)) * 60 - 30 : 0;

  // ── Minimized widget ──────────────────────────────────────────────────────

  if (minimized) {
    return (
      <div className="fixed z-50 rounded-2xl shadow-2xl flex items-center gap-2.5 px-4 py-2.5"
        style={{ left: panelPos.x < 0 ? 'auto' : panelPos.x, top: panelPos.y < 0 ? 'auto' : panelPos.y, right: panelPos.x < 0 ? 24 : 'auto', bottom: panelPos.x < 0 ? 80 : 'auto', background: 'var(--float-bg)', border: '1px solid var(--float-border)' }}>
        <span className="text-white font-bold text-xl tabular-nums">{bpm}</span>
        <span className="text-xs text-gray-500">BPM</span>
        {isHost && (
          <button onClick={togglePlay}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
            style={{ background: isPlaying ? 'rgba(239,68,68,0.15)' : 'rgba(129,140,248,0.2)', color: isPlaying ? '#f87171' : '#a5b4fc' }}>
            {isPlaying ? '⏹' : '▶'}
          </button>
        )}
        <div className="w-2 h-2 rounded-full transition-all duration-75"
          style={{ background: flash ? '#818cf8' : 'rgba(129,140,248,0.2)', boxShadow: flash ? '0 0 6px #818cf8' : 'none' }} />
        <div className="w-px h-5 bg-white/10" />
        <button onClick={() => setMinimized(false)} className="text-gray-500 hover:text-white transition-colors">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
        </button>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
    );
  }

  // ── Full panel ────────────────────────────────────────────────────────────

  return (
    <div ref={panelRef} className="phone-sheet fixed z-50 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      style={{
        left: panelPos.x < 0 ? 'auto' : panelPos.x,
        top: panelPos.y < 0 ? 'auto' : panelPos.y,
        right: panelPos.x < 0 ? 24 : 'auto',
        bottom: panelPos.x < 0 ? 80 : 'auto',
        width: panelSize.w, height: panelSize.h,
        background: 'var(--float-bg)', border: '1px solid var(--float-border)',
        cursor: isDragging ? 'grabbing' : 'default',
        userSelect: isDragging ? 'none' : undefined,
      }}>

      {/* Beat-1 flash overlay */}
      {showFlash && panelFlash && (
        <div className="absolute inset-0 pointer-events-none z-10 rounded-2xl"
          style={{ background: 'rgba(129,140,248,0.1)', transition: 'opacity 0.06s' }} />
      )}

      {/* Header — drag to move */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
        onMouseDown={onHeaderMouseDown}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', cursor: isDragging ? 'grabbing' : 'grab' }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-white tracking-wide">{t('Metronome')}</span>
          {!isHost && (
            <span className="text-xs px-1.5 py-0.5 rounded shrink-0"
              style={{ background: 'rgba(129,140,248,0.15)', color: '#a5b4fc' }}>⟳ {t('Synced')}</span>
          )}
          {timerRemaining && (
            <span className="text-xs font-mono tabular-nums shrink-0" style={{ color: '#f59e0b' }}>⏱ {timerRemaining}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setMinimized(true)} title={t('Minimize')}
            className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-white transition-colors">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 0 2-2h3M3 16h3a2 2 0 0 0 2 2v3" /></svg>
          </button>
          <button onClick={onClose} title={t('Close')}
            className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-white transition-colors">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-4">

        {/* Visual section */}
        <div className="flex items-center gap-4 justify-center">
          {showPendulum && (
            <div className="relative shrink-0 flex items-end justify-center" style={{ width: 64, height: 80 }}>
              <div className="absolute bottom-0 left-1/2 -translate-x-px bg-white/10" style={{ width: 1, height: 72 }} />
              <div className="absolute origin-bottom left-1/2 -translate-x-px"
                style={{
                  bottom: 0, width: 2, height: 72,
                  background: isPlaying ? '#818cf8' : 'rgba(255,255,255,0.2)',
                  transform: `rotate(${isPlaying && currentBeat >= 0 ? pendulumAngle : 0}deg)`,
                  transition: isPlaying && currentBeat >= 0
                    ? `transform ${(60 / bpm) * 0.48}s ease-in-out` : 'none',
                }}>
                <div style={{
                  position: 'absolute', top: -7, left: '50%', transform: 'translateX(-50%)',
                  width: 14, height: 14, borderRadius: '50%',
                  background: flash ? '#f59e0b' : isPlaying ? '#818cf8' : 'rgba(255,255,255,0.2)',
                  boxShadow: flash ? '0 0 14px #f59e0b' : 'none',
                  transition: 'background 0.04s',
                }} />
              </div>
            </div>
          )}
          <div className="flex flex-col items-center gap-2">
            {showDots && (
              <div className="flex flex-wrap justify-center gap-1.5" style={{ maxWidth: 200 }}>
                {Array.from({ length: beatsPerBar }).map((_, i) => (
                  <div key={i} style={{
                    width: i === 0 ? 13 : 9, height: i === 0 ? 13 : 9,
                    borderRadius: '50%',
                    background: currentBeat === i && isPlaying
                      ? i === 0 ? '#f59e0b' : '#818cf8'
                      : i === 0 ? 'rgba(245,158,11,0.25)' : 'rgba(129,140,248,0.15)',
                    boxShadow: currentBeat === i && isPlaying
                      ? i === 0 ? '0 0 10px rgba(245,158,11,0.6)' : '0 0 8px rgba(129,140,248,0.5)'
                      : 'none',
                    transition: 'all 0.04s',
                  }} />
                ))}
              </div>
            )}
            <div className="text-center">
              <span className="text-3xl font-bold tabular-nums"
                style={{ color: currentBeat === 0 && isPlaying ? '#f59e0b' : '#e5e7eb' }}>
                {isPlaying && currentBeat >= 0 ? currentBeat + 1 : '—'}
              </span>
              <span className="text-lg text-gray-600"> / {beatsPerBar}</span>
            </div>
            <span className="text-xs italic" style={{ color: 'rgba(129,140,248,0.7)' }}>{tempoMarking}</span>
          </div>
        </div>

        {/* ── TEMPO ── */}
        <div className="flex flex-col gap-2">
          <SectionHeader title="Tempo" isOpen={open.tempo} onToggle={() => toggleOpen('tempo')} />
          {open.tempo && (
            <>
              <div className="flex items-center gap-2">
                <button onClick={() => isHost && changeBpm(bpm - 1)} disabled={!isHost || bpm <= 20}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-300 disabled:opacity-30 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M5 12h14" /></svg>
                </button>
                <div className="flex-1 text-center">
                  {bpmEditing ? (
                    <div className="flex flex-col items-center gap-0.5">
                      <input
                        ref={bpmInputRef}
                        type="text"
                        inputMode="decimal"
                        value={bpmInput}
                        onChange={e => {
                          const raw = e.target.value;
                          setBpmInput(raw);
                          const preview = evalBpmExpr(raw, bpm);
                          setBpmPreview(preview !== null && preview !== parseFloat(raw) ? preview : null);
                        }}
                        onBlur={() => {
                          const v = evalBpmExpr(bpmInput, bpm) ?? parseFloat(bpmInput);
                          if (!isNaN(v)) changeBpm(v);
                          setBpmEditing(false); setBpmPreview(null);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const v = evalBpmExpr(bpmInput, bpm) ?? parseFloat(bpmInput);
                            if (!isNaN(v)) changeBpm(v);
                            setBpmEditing(false); setBpmPreview(null);
                          }
                          if (e.key === 'Escape') { setBpmEditing(false); setBpmPreview(null); }
                        }}
                        placeholder={String(bpm)}
                        className="w-full text-center text-4xl font-bold bg-transparent text-white outline-none tabular-nums"
                        style={{ borderBottom: `1px solid ${bpmPreview !== null ? '#f59e0b' : '#818cf8'}` }}
                        autoFocus
                      />
                      {bpmPreview !== null ? (
                        <span className="text-xs font-mono tabular-nums" style={{ color: '#f59e0b' }}>= {bpmPreview}</span>
                      ) : (
                        <span className="text-[10px] text-gray-600 select-none">+10 · *2 · 120+5 · 200/3</span>
                      )}
                    </div>
                  ) : (
                    <div className="relative group cursor-text"
                      onDoubleClick={() => { if (!isHost) return; setBpmInput(String(bpm)); setBpmEditing(true); setTimeout(() => bpmInputRef.current?.select(), 10); }}>
                      <span className="text-4xl font-bold text-white tabular-nums">{bpm}</span>
                      {isHost && <span className="absolute -top-1 right-0 text-[10px] text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity select-none">{t('dbl-click')}</span>}
                    </div>
                  )}
                </div>
                <button onClick={() => isHost && changeBpm(bpm + 1)} disabled={!isHost || bpm >= 300}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-300 disabled:opacity-30 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14" /></svg>
                </button>
              </div>
              <input type="range" min={20} max={300} step={0.5} value={bpm}
                onChange={e => isHost && changeBpm(+e.target.value)}
                disabled={!isHost} className="w-full disabled:opacity-40"
                style={{ accentColor: '#818cf8' }} />

              {/* Tempo marking dropdown */}
              <div className="relative">
                <button onClick={() => setShowTempoDD(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#818cf8' }}>
                  <span>{tempoMarking}</span>
                  <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 transition-transform ${showTempoDD ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {showTempoDD && (
                  <div className="absolute bottom-full mb-1 left-0 right-0 z-20 rounded-xl overflow-hidden"
                    style={{ background: 'var(--float-bg)', border: '1px solid var(--float-border)', maxHeight: 220, overflowY: 'auto' }}>
                    {TEMPO_MARKINGS.map(tm => (
                      <button key={tm.name}
                        onClick={() => { if (!isHost) return; changeBpm(tm.bpm); setShowTempoDD(false); }}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-white/5 transition-colors"
                        style={{ color: tempoMarking === tm.name ? '#818cf8' : '#9ca3af' }}>
                        <span>{tm.name}{lang === 'zh' && <span className="ml-1.5 text-xs text-gray-500">{t(tm.name + '|meaning')}</span>}</span>
                        <span className="text-xs text-gray-600">{tm.range}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Play / Tap */}
        <div className="flex gap-2">
          <button onClick={togglePlay} disabled={!isHost}
            className="flex-1 h-10 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 select-none"
            style={{
              background: isPlaying ? 'rgba(239,68,68,0.15)' : 'rgba(129,140,248,0.2)',
              color: isPlaying ? '#f87171' : '#a5b4fc',
              border: isPlaying ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(129,140,248,0.3)',
            }}>
            {isPlaying ? '⏹ ' + t('Stop') : '▶ ' + t('Start')}
          </button>
          {isHost && (
            <button onClick={tap} className="flex-1 h-10 rounded-xl text-sm font-semibold select-none"
              style={{ background: 'rgba(255,255,255,0.05)', color: '#d1d5db', border: '1px solid rgba(255,255,255,0.08)' }}>
              {t('Tap')}
            </button>
          )}
        </div>
        {isHost && <p className="text-xs text-gray-600 -mt-2 text-center">{t('Space = start/stop · ↑↓ = ±1 BPM · Shift±5 · Ctrl±10')}</p>}

        {/* ── TIME SIGNATURE ── */}
        <div className="flex flex-col gap-2">
          <SectionHeader title="Time Signature" isOpen={open.timesig} onToggle={() => toggleOpen('timesig')} />
          {open.timesig && (
            <>
              {/* Presets */}
              <div className="flex flex-wrap gap-1">
                {TIME_SIG_PRESETS.map(p => (
                  <button key={`${p.n}/${p.d}`}
                    onClick={() => {
                      if (!isHost) return;
                      setBeatsPerBar(p.n); R.current.beatsPerBar = p.n;
                      setDenominator(p.d);
                      emitRef.current({ beatsPerBar: p.n, denominator: p.d });
                    }}
                    className="px-2 py-1 rounded text-xs font-medium transition-colors"
                    style={{
                      background: beatsPerBar === p.n && denominator === p.d ? '#818cf8' : 'rgba(255,255,255,0.05)',
                      color: beatsPerBar === p.n && denominator === p.d ? '#fff' : '#9ca3af',
                    }}>
                    {p.n}/{p.d}
                  </button>
                ))}
              </div>
              {/* Custom numerator + denominator */}
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-center gap-1 flex-1">
                  <span className="text-xs text-gray-600">{t('Beats (1–16)')}</span>
                  <div className="flex items-center gap-1">
                    <button disabled={!isHost || beatsPerBar <= 1}
                      onClick={() => { if (!isHost) return; const v = Math.max(1, beatsPerBar - 1); setBeatsPerBar(v); R.current.beatsPerBar = v; emitRef.current({ beatsPerBar: v }); }}
                      className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30"
                      style={{ background: 'rgba(255,255,255,0.05)' }}>−</button>
                    <span className="w-6 text-center text-white font-bold">{beatsPerBar}</span>
                    <button disabled={!isHost || beatsPerBar >= 16}
                      onClick={() => { if (!isHost) return; const v = Math.min(16, beatsPerBar + 1); setBeatsPerBar(v); R.current.beatsPerBar = v; emitRef.current({ beatsPerBar: v }); }}
                      className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30"
                      style={{ background: 'rgba(255,255,255,0.05)' }}>+</button>
                  </div>
                </div>
                <span className="text-2xl text-gray-600 pb-1">/</span>
                <div className="flex flex-col items-center gap-1 flex-1">
                  <span className="text-xs text-gray-600">{t('Note value')}</span>
                  <div className="flex gap-1">
                    {[2, 4, 8, 16, 32].map(d => (
                      <button key={d}
                        onClick={() => { if (!isHost) return; setDenominator(d); emitRef.current({ denominator: d }); }}
                        className="w-7 h-7 rounded text-xs font-medium transition-colors"
                        style={{ background: denominator === d ? '#818cf8' : 'rgba(255,255,255,0.05)', color: denominator === d ? '#fff' : '#9ca3af' }}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {/* Subdivision */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 shrink-0">{t('Subdivision')}</span>
                <div className="flex gap-1">
                  {SUBDIV_OPTIONS.map(s => (
                    <button key={s.value} title={t(s.name)}
                      onClick={() => { if (!isHost) return; setSubdivision(s.value); R.current.subdivision = s.value; emitRef.current({ subdivision: s.value }); }}
                      className="w-8 h-7 rounded text-xs font-medium transition-colors"
                      style={{ background: subdivision === s.value ? '#818cf8' : 'rgba(255,255,255,0.05)', color: subdivision === s.value ? '#fff' : '#9ca3af' }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── SOUND ── */}
        <div className="flex flex-col gap-2">
          <SectionHeader title="Sound" isOpen={open.sound} onToggle={() => toggleOpen('sound')} />
          {open.sound && (
            <>
              <div className="flex flex-wrap gap-1">
                {SOUND_TYPES.map(s => (
                  <button key={s.id}
                    onClick={() => { if (!isHost) return; setSoundType(s.id); R.current.soundType = s.id; emitRef.current({ soundType: s.id }); }}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{ background: soundType === s.id ? '#818cf8' : 'rgba(255,255,255,0.05)', color: soundType === s.id ? '#fff' : '#9ca3af' }}>
                    {t(s.label)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-600">{t('Accent pitch')}</span>
                  <input type="range" min={400} max={3000} step={50} value={accentPitch}
                    onChange={e => { setAccentPitch(+e.target.value); R.current.accentPitch = +e.target.value; }}
                    className="w-full" style={{ accentColor: '#f59e0b' }} />
                  <span className="text-xs text-gray-600 tabular-nums">{accentPitch} Hz</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-600">{t('Normal pitch')}</span>
                  <input type="range" min={200} max={2000} step={50} value={normalPitch}
                    onChange={e => { setNormalPitch(+e.target.value); R.current.normalPitch = +e.target.value; }}
                    className="w-full" style={{ accentColor: '#818cf8' }} />
                  <span className="text-xs text-gray-600 tabular-nums">{normalPitch} Hz</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setMuted(v => !v)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors text-sm"
                  style={{ background: muted ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)', color: muted ? '#f87171' : '#9ca3af' }}>
                  {muted ? '🔇' : '🔊'}
                </button>
                <input type="range" min={0} max={1} step={0.05} value={volume}
                  onChange={e => { setVolume(+e.target.value); R.current.volume = +e.target.value; }}
                  disabled={muted} className="flex-1 disabled:opacity-40" style={{ accentColor: '#818cf8' }} />
                <span className="text-xs text-gray-500 w-8 text-right tabular-nums">{Math.round(volume * 100)}%</span>
              </div>
              {/* Visual toggles */}
              <div className="flex items-center gap-3 pt-0.5">
                <span className="text-xs text-gray-600">{t('Visual:')}</span>
                {([['pendulum', showPendulum, setShowPendulum], ['flash', showFlash, setShowFlash], ['dots', showDots, setShowDots]] as [string, boolean, (v: boolean) => void][]).map(([label, val, setter]) => (
                  <label key={label} className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} className="w-3 h-3 accent-indigo-400" />
                    <span className="text-xs text-gray-500 capitalize">{t(label)}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── ACCENTS ── */}
        <div className="flex flex-col gap-2">
          <SectionHeader title="Accents" isOpen={open.accents} onToggle={() => toggleOpen('accents')} />
          {open.accents && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1 select-none"
                onMouseLeave={() => { accentDragging.current = false; }}
                onMouseUp={() => { accentDragging.current = false; }}>
                {Array.from({ length: beatsPerBar }).map((_, i) => {
                  const level = accents[i] ?? 0;
                  return (
                    <button key={i}
                      disabled={!isHost}
                      title={level === 2 ? t('Strong') : level === 1 ? t('Medium') : t('Off')}
                      onMouseDown={() => {
                        if (!isHost) return;
                        const next = ((accents[i] + 1) % 3) as AccentLevel;
                        accentDragging.current = true;
                        accentDragValue.current = next;
                        setAccents(prev => { const a = [...prev] as AccentLevel[]; a[i] = next; return a; });
                      }}
                      onMouseEnter={() => {
                        if (!accentDragging.current || !isHost) return;
                        setAccents(prev => { const a = [...prev] as AccentLevel[]; a[i] = accentDragValue.current; return a; });
                      }}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold transition-all"
                      style={{
                        background: level === 2 ? '#f59e0b' : level === 1 ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.05)',
                        color: level === 2 ? '#fff' : level === 1 ? '#fbbf24' : '#4b5563',
                        border: level === 0 ? '1px solid rgba(255,255,255,0.07)' : 'none',
                        cursor: 'pointer',
                      }}>
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-gray-600">{t('Click or drag to cycle: strong → medium → off')}</span>
            </div>
          )}
        </div>

        {/* ── TEMPO TRAINER ── */}
        {isHost && (
          <div className="flex flex-col gap-2 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <SectionHeader title="Tempo Trainer" isOpen={open.trainer} onToggle={() => toggleOpen('trainer')} />
            {open.trainer && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-4 gap-1">
                  {(['off', 'gradual', 'random', 'target'] as TrainerMode[]).map(m => (
                    <button key={m} onClick={() => setTrainerMode(m)}
                      className="py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{ background: trainerMode === m ? '#818cf8' : 'rgba(255,255,255,0.05)', color: trainerMode === m ? '#fff' : '#9ca3af' }}>
                      {m === 'off' ? t('Off') : m === 'gradual' ? '+BPM' : m === 'random' ? t('Mute') : t('Target')}
                    </button>
                  ))}
                </div>

                {trainerMode === 'gradual' && (
                  <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                    <span>{t('Increase BPM by')}</span>
                    <input type="number" min={0.5} max={20} step={0.5} value={trainerAmount}
                      onChange={e => setTrainerAmount(Math.max(0.5, +e.target.value))}
                      className="w-12 text-center rounded bg-white/5 border border-white/10 text-white py-1" />
                    <span>{t('every|gradual')}</span>
                    <input type="number" min={1} max={64} value={trainerEvery}
                      onChange={e => setTrainerEvery(Math.max(1, +e.target.value))}
                      className="w-12 text-center rounded bg-white/5 border border-white/10 text-white py-1" />
                    <span>{t('bars|gradual')}</span>
                  </div>
                )}

                {trainerMode === 'random' && (
                  <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                    <span>{t('Randomly mute 1 in every')}</span>
                    <input type="number" min={2} max={16} value={trainerEvery}
                      onChange={e => setTrainerEvery(Math.max(2, +e.target.value))}
                      className="w-12 text-center rounded bg-white/5 border border-white/10 text-white py-1" />
                    <span>{t('bars|random')}</span>
                  </div>
                )}

                {trainerMode === 'target' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                      <span>{t('Reach')}</span>
                      <input type="number" min={20} max={300} value={trainerTargetBpm}
                        onChange={e => setTrainerTargetBpm(Math.max(20, Math.min(300, +e.target.value)))}
                        className="w-14 text-center rounded bg-white/5 border border-white/10 text-white py-1" />
                      <span>{t('BPM in')}</span>
                      <input type="number" min={1} max={60} value={trainerMinutes}
                        onChange={e => setTrainerMinutes(Math.max(1, +e.target.value))}
                        className="w-12 text-center rounded bg-white/5 border border-white/10 text-white py-1" />
                      <span>{t('minutes|target')}</span>
                    </div>
                    <span className="text-xs text-gray-600">{t('{from} BPM → {to} BPM over {min} min', { from: bpm, to: trainerTargetBpm, min: trainerMinutes })}</span>
                  </div>
                )}

                {trainerMode !== 'off' && isPlaying && (
                  <div className="w-full rounded-full overflow-hidden" style={{ height: 3, background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: trainerMode === 'gradual'
                          ? `${(trainerBarCount.current / Math.max(1, trainerEvery)) * 100}%`
                          : trainerMode === 'target'
                            ? `${Math.min(100, ((bpm - trainerStartBpm) / Math.max(1, trainerTargetBpm - trainerStartBpm)) * 100)}%`
                            : '0%',
                        background: '#818cf8',
                      }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── PRESETS ── */}
        <div className="flex flex-col gap-2 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <SectionHeader title="Presets" isOpen={open.presets} onToggle={() => toggleOpen('presets')} />
          {open.presets && (
            <div className="flex flex-col gap-1.5">
              {presets.length === 0 && <span className="text-xs text-gray-600">{t('No presets saved.')}</span>}
              {presets.map(p => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2 group transition-colors"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <button onClick={() => loadPreset(p)} className="flex-1 text-left min-w-0">
                    <span className="text-sm text-gray-300 font-medium truncate block">{p.name}</span>
                    <span className="text-xs text-gray-600">{p.bpm} BPM · {p.beatsPerBar}/{p.denominator} · {p.soundType}</span>
                  </button>
                  <button onClick={() => deletePreset(p.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all shrink-0">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              {isHost && (
                <div className="flex gap-2">
                  <input type="text" placeholder={t('Name this preset…')}
                    value={presetName} onChange={e => setPresetName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && savePreset()}
                    className="flex-1 text-sm rounded-lg px-3 py-1.5 text-white placeholder-gray-600 outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }} />
                  <button onClick={savePreset} disabled={!presetName.trim()}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition-colors"
                    style={{ background: '#818cf8', color: '#fff' }}>
                    {t('Save')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── TIMER ── */}
        <div className="flex flex-col gap-2 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <SectionHeader title="Timer" isOpen={open.timer} onToggle={() => toggleOpen('timer')} />
          {open.timer && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-1">
                {(['off', 'time', 'bars'] as TimerMode[]).map(m => (
                  <button key={m}
                    onClick={() => { setTimerMode(m); setTimerRemaining(null); timerBarCount.current = 0; }}
                    className="py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{ background: timerMode === m ? '#818cf8' : 'rgba(255,255,255,0.05)', color: timerMode === m ? '#fff' : '#9ca3af' }}>
                    {m === 'off' ? t('Off') : m === 'time' ? t('Minutes') : t('Bars')}
                  </button>
                ))}
              </div>
              {timerMode === 'time' && (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>{t('Stop after|minutes')}</span>
                  <input type="number" min={1} max={120} value={timerMinutes}
                    onChange={e => setTimerMinutes(Math.max(1, +e.target.value))}
                    className="w-14 text-center rounded bg-white/5 border border-white/10 text-white py-1" />
                  <span>{t('minutes|timer')}</span>
                </div>
              )}
              {timerMode === 'bars' && (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>{t('Stop after|bars')}</span>
                  <input type="number" min={1} max={9999} value={timerBars}
                    onChange={e => setTimerBars(Math.max(1, +e.target.value))}
                    className="w-16 text-center rounded bg-white/5 border border-white/10 text-white py-1" />
                  <span>{t('bars|timer')}</span>
                </div>
              )}
              {timerRemaining && (
                <p className="text-sm font-mono tabular-nums" style={{ color: '#f59e0b' }}>⏱ {timerRemaining} remaining</p>
              )}
            </div>
          )}
        </div>

        <div className="h-2" /> {/* bottom breathing room */}
      </div>

      {/* Resize handles */}
      {/* Edges */}
      <div onMouseDown={e => startResize(e, { r: true })} className="absolute top-4 bottom-4 right-0 w-1.5 cursor-ew-resize" style={{ right: -1 }} />
      <div onMouseDown={e => startResize(e, { l: true })} className="absolute top-4 bottom-4 left-0 w-1.5 cursor-ew-resize" style={{ left: -1 }} />
      <div onMouseDown={e => startResize(e, { b: true })} className="absolute left-4 right-4 bottom-0 h-1.5 cursor-ns-resize" style={{ bottom: -1 }} />
      <div onMouseDown={e => startResize(e, { t: true })} className="absolute left-4 right-4 top-0 h-1.5 cursor-ns-resize" style={{ top: -1 }} />
      {/* Corners */}
      <div onMouseDown={e => startResize(e, { r: true, b: true })} className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize" />
      <div onMouseDown={e => startResize(e, { l: true, b: true })} className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize" />
      <div onMouseDown={e => startResize(e, { r: true, t: true })} className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize" />
      <div onMouseDown={e => startResize(e, { l: true, t: true })} className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize" />
    </div>
  );
}
