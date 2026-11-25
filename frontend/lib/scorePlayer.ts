// Plays a score in the browser with real instrument recordings (CC0 samples in /public/samples:
// VCSL Kawai grand piano, VSCO-2 CE solo violin and cello section). The written score is first
// turned into a performance (performance.ts: repeats, tempo changes, fermatas, articulation,
// dynamics); notes are then scheduled slightly ahead so timing stays steady.
// If the samples can't load, a simple synth is used instead.

import type { ScoreModel } from './musicxml';
import { buildPerformance, type Performance, type PerfNote } from './performance';

// 'auto' picks a sound for each part from its name / clef (a cello part plays as cello).
export type Instrument = 'auto' | 'piano' | 'cello' | 'violin';
export type Sound = 'piano' | 'cello' | 'violin';

/** The sound a part should play with, from its name, or its clef and staves when unnamed. */
export function soundForPart(score: ScoreModel, part: number): Sound {
  const name = (score.parts?.[part] ?? '').toLowerCase();
  if (/cello|violoncel|\bvc\.?\b|contrabass|double bass|大提琴|低音提琴/.test(name)) return 'cello';
  if (/violin|viola|\bvln|\bvla|fiddle|erhu|小提琴|中提琴|二胡|胡琴/.test(name)) return 'violin';
  if (/piano|keyboard|klavier|钢琴/.test(name)) return 'piano';
  const info = score.partInfo?.[part];
  // "Voice": a single melody line (the AI reader's name for it) — a string sound by clef
  if (/^voice\b/.test(name)) return info?.clef === 'F' ? 'cello' : 'violin';
  if (info) {
    if (info.staves >= 2) return 'piano';
    if (info.clef === 'F') return 'cello';
    if (info.clef === 'G' || info.clef === 'C') return 'violin';
  }
  // no clef (MIDI): judge by range
  const ps = score.notes.filter(n => (n.part ?? 0) === part).map(n => n.midi).sort((a, b) => a - b);
  if (ps.length && (score.parts?.length ?? 1) > 1) {
    const med = ps[ps.length >> 1];
    if (med < 55 && ps[ps.length - 1] <= 79) return 'cello';
  }
  return 'piano';
}

// off: where the note really starts in the recording (s); norm: gain that evens out its loudness
interface Sample { midi: number; buf: AudioBuffer; off: number; norm: number }
interface SampleSet { [layer: string]: Sample[] }

/** Measure a recording: when its sound starts (so the note lands on the beat, not late) and how
 *  loud its steady part is (so neighbouring notes don't jump in volume). */
function analyse(buf: AudioBuffer): { off: number; level: number } {
  const x = buf.getChannelData(0), sr = buf.sampleRate, hop = Math.round(sr * 0.005);
  const env: number[] = [];
  for (let i = 0; i + hop <= x.length; i += hop) { let m = 0; for (let k = i; k < i + hop; k++) m = Math.max(m, Math.abs(x[k])); env.push(m); }
  const peak = Math.max(...env, 1e-6);
  const first = env.findIndex(v => v > peak * 0.12);
  const off = Math.max(0, (first < 0 ? 0 : first) * hop / sr - 0.01);
  const a = Math.floor((off + 0.4) * sr / hop), b = Math.min(env.length, Math.floor((off + 1.6) * sr / hop));
  let sum = 0; for (let i = a; i < b; i++) sum += env[i];
  return { off, level: b > a ? sum / (b - a) : peak };
}

// Recordings are shared by every player on the page (decoded once per instrument).
const loaded = new Map<string, Promise<SampleSet | null>>();
let manifestPromise: Promise<{ instruments: Record<string, Record<string, Record<string, string>>> } | null> | null = null;
function loadSamples(ctx: AudioContext, inst: 'piano' | 'cello' | 'violin'): Promise<SampleSet | null> {
  if (loaded.has(inst)) return loaded.get(inst)!;
  const p = (async () => {
    try {
      manifestPromise ||= fetch('/samples/manifest.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
      const manifest = await manifestPromise;
      const layers = manifest?.instruments?.[inst];
      if (!layers) return null;
      const set: SampleSet = {};
      await Promise.all(Object.entries(layers).map(async ([layer, files]) => {
        const list = await Promise.all(Object.entries(files).map(async ([midi, file]) => {
          const data = await (await fetch(`/samples/${file}`)).arrayBuffer();
          const buf = await ctx.decodeAudioData(data);
          const { off, level } = analyse(buf);
          return { midi: Number(midi), buf, off: inst === 'piano' ? 0 : off, level };
        }));
        // even out loudness within the layer (bowed recordings vary by several dB)
        const levels = list.map(x => x.level).sort((p, q) => p - q);
        const median = levels[Math.floor(levels.length / 2)] || 1;
        set[layer] = list.map(x => ({ midi: x.midi, buf: x.buf, off: x.off,
          norm: inst === 'piano' ? 1 : Math.max(0.5, Math.min(2, median / (x.level || median))) }));
        set[layer].sort((a, b) => a.midi - b.midi);
      }));
      return set;
    } catch { return null; }
  })();
  loaded.set(inst, p);
  // A failed download is not remembered: the next Play tries again (instead of beeping forever)
  void p.then(set => { if (!set) { loaded.delete(inst); manifestPromise = null; } });
  return p;
}

// A short, soft room so notes don't sound dry: decaying noise as an impulse response.
function makeReverb(ctx: AudioContext) {
  const len = Math.floor(ctx.sampleRate * 1.8);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  return conv;
}

export class ScorePlayer {
  private ctx: AudioContext | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private nextIndex = 0;
  private startT = 0;        // performance time (s, at the score's tempo) where playback started
  private startTime = 0;     // audio clock time when startT sounds
  private voices: { nodes: AudioScheduledSourceNode[]; gain: GainNode; end: number }[] = [];
  private lastBarIdx = -1;
  private run = 0;
  private musicStart = 0;    // audio clock time the first note sounds (after any count-in)
  private perf: Performance;
  private samples = new Map<Sound, SampleSet | null>();

  tempo = 80;                // quarter notes per minute at the start of the piece (sets the speed)
  instrument: Instrument = 'auto';
  playing = false;
  countIn = false;                         // one bar of clicks before the music starts
  mutedParts = new Set<number>();          // accompaniment: the student's part is silent
  partSounds: Record<number, Sound> = {};  // a sound chosen for one part (else: by its name / clef)
  partVolume: Record<number, number> = {}; // 0..1.5 per part (1 = as written)
  private sounding: { part: number; from: number; to: number }[] = []; // for the "playing now" lights
  loop: { from: number; to: number } | null = null; // performance seconds; playback repeats this range
  onBar: (bar: number) => void = () => {};
  onEnd: () => void = () => {};
  onLoading: (loading: boolean) => void = () => {};

  constructor(private score: ScoreModel) {
    this.perf = buildPerformance(score);
    this.tempo = Math.round(this.perf.baseBpm);
  }

  private get speed() { return this.tempo / (this.perf.baseBpm || 80); }

  setScore(score: ScoreModel) {
    const was = this.playing; const at = this.currentTime();
    this.stop(); this.score = score; this.perf = buildPerformance(score);
    if (was) void this.play(at);
  }

  /** Current position in performance seconds (at the score's tempo). */
  currentTime(): number {
    if (!this.playing || !this.ctx) return this.startT;
    const t = this.startT + (this.ctx.currentTime - this.startTime) * this.speed;
    // The loop restart is scheduled slightly ahead; until it sounds we are still at the end of the range.
    if (this.loop && t < this.loop.from) return this.loop.to - (this.loop.from - t);
    return t;
  }

  private ensureContext() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.gain.value = 0.8; this.dry.connect(comp);
    const rev = makeReverb(ctx);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.2;
    this.wet.connect(rev).connect(comp);
    this.ctx = ctx;
    return ctx;
  }

  /** The sound each part plays with right now (what the mixer shows). */
  soundsByPart(): Sound[] {
    return (this.score.parts ?? ['']).map((_, i) => this.soundOf(i));
  }
  /** Parts with a note sounding at this moment (as heard). */
  activeParts(): Set<number> {
    const ctx = this.ctx, out = new Set<number>();
    if (!ctx || !this.playing) return out;
    const now = ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
    for (const v of this.sounding) if (v.from <= now && now < v.to) out.add(v.part);
    this.sounding = this.sounding.filter(v => v.to > now - 1);
    return out;
  }

  private soundOf(part: number): Sound {
    return this.partSounds[part] ?? (this.instrument === 'auto' ? soundForPart(this.score, part) : this.instrument);
  }

  /** Start from a performance time (seconds). Loads the recordings first if needed. */
  async play(fromT = 0) {
    this.stop();
    const run = ++this.run;              // a newer play/stop cancels this one
    this.startT = fromT;
    const ctx = this.ensureContext();
    // wake the audio first (browsers start it asleep); notes scheduled before that would be lost
    try { await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 800))]); } catch {}
    if (run !== this.run) return;
    const parts = new Set(this.perf.notes.map(n => n.part));
    const want = [...new Set([...parts].map(p => this.soundOf(p)))].filter(w => !this.samples.has(w));
    if (want.length) {
      this.onLoading(true);
      const sets = await Promise.all(want.map(w => loadSamples(ctx, w)));
      want.forEach((w, i) => { if (sets[i]) this.samples.set(w, sets[i]); });
      this.onLoading(false);
    }
    if (run !== this.run) return;        // stopped (or restarted) while the sounds were loading
    this.playing = true;
    this.startT = fromT;
    this.startTime = ctx.currentTime + 0.08;
    if (this.countIn) this.startTime += this.clickBar(this.startTime, fromT);
    this.musicStart = this.startTime;
    this.nextIndex = this.perf.notes.findIndex(n => n.t >= fromT - 1e-6);
    if (this.nextIndex < 0) this.nextIndex = this.perf.notes.length;
    this.lastBarIdx = -1;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
    const tick = () => {
      if (!this.playing) return;
      const t = this.currentTime();
      const idx = this.barIndexAt(this.heardTime());
      if (idx !== this.lastBarIdx && idx >= 0) { this.lastBarIdx = idx; this.onBar(this.perf.bars[idx].n); }
      if (!this.loop && t >= this.perf.total + 0.3) { this.stop(); this.onEnd(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Count-in: one bar of clicks (accented first beat) ending at `at`. Returns its length in seconds. */
  private clickBar(at: number, fromT: number): number {
    const ctx = this.ctx!;
    const idx = Math.max(0, this.barIndexAt(fromT));
    const written = this.score.bars.find(b => b.n === this.perf.bars[idx]?.n);
    const beats = Math.max(2, Math.round(written?.beats ?? 4));
    const beatSec = 60 / this.tempo;
    for (let k = 0; k < beats; k++) {
      const t = at + k * beatSec;
      const o = ctx.createOscillator(); o.frequency.value = k === 0 ? 1500 : 1000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g); g.connect(this.dry!);
      o.start(t); o.stop(t + 0.08);
      this.voices.push({ nodes: [o], gain: g, end: t + 0.08 });
    }
    return beats * beatSec;
  }

  /** What the listener hears now (audio output delay taken off), for drawing. */
  private heardTime(): number {
    const ctx = this.ctx;
    if (!this.playing || !ctx) return this.startT;
    const lag = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    const t = this.startT + (ctx.currentTime - lag - this.startTime) * this.speed;
    if (this.loop && t < this.loop.from) return this.loop.to - (this.loop.from - t);
    return Math.max(this.startT - 1e-6, t);
  }

  /** Where playback is: the written bar and how far through it (0..1), or null before the music starts. */
  progress(): { bar: number; frac: number } | null {
    const t = this.heardTime();
    const idx = this.barIndexAt(t);
    if (idx < 0) return null;
    const b = this.perf.bars[idx];
    if (this.playing && this.ctx && this.ctx.currentTime < this.musicStart) return { bar: b.n, frac: 0 }; // counting in
    return { bar: b.n, frac: Math.max(0, Math.min(1, (t - b.t) / (b.dur || 1))) };
  }

  /** Heard position and length of the whole performance, in seconds at the score's tempo. */
  position(): { t: number; total: number } { return { t: Math.max(0, this.heardTime()), total: this.perf.total }; }
  /** Performance time where a fraction (0..1) of the piece falls. */
  timeAt(frac: number) { return Math.max(0, Math.min(1, frac)) * this.perf.total; }

  /** Start at the first time a written bar is played. */
  playFromBar(bar: number) {
    const b = this.perf.bars.find(x => x.n === bar);
    void this.play(b ? b.t : 0);
  }

  stop() {
    this.run++;
    this.sounding = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.raf);
    if (this.playing && this.ctx) this.startT = this.currentTime();
    this.playing = false;
    const now = this.ctx?.currentTime ?? 0;
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, 0.03);
        v.nodes.forEach(o => o.stop(now + 0.2));
      } catch {}
    }
    this.voices = [];
  }

  /** Change speed without a jump: keep the current place. */
  setTempo(bpm: number) {
    if (bpm === this.tempo) return;
    if (!this.playing) { this.tempo = bpm; return; }
    const t = this.currentTime();
    this.stop(); this.tempo = bpm; void this.play(t);
  }

  /** Loop written bars from..to (inclusive, 1-based), or null to stop looping. */
  setLoopBars(range: { from: number; to: number } | null) {
    if (!range) { this.loop = null; return; }
    const lo = Math.min(range.from, range.to), hi = Math.max(range.from, range.to);
    const a = this.perf.bars.find(b => b.n === lo);
    const z = this.perf.bars.find(b => b.n === hi && (!a || b.t >= a.t));
    this.loop = a && z ? { from: a.t, to: z.t + z.dur } : null;
  }

  private barIndexAt(t: number): number {
    const bars = this.perf.bars;
    let lo = 0, hi = bars.length - 1, ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (bars[m].t <= t + 1e-6) { ans = m; lo = m + 1; } else hi = m - 1;
    }
    return ans;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    // a hidden tab only runs timers about once a second: schedule further ahead then
    const horizon = ctx.currentTime + (typeof document !== 'undefined' && document.hidden ? 1.5 : 0.3);
    const notes = this.perf.notes;
    const sp = this.speed;
    while (true) {
      // Loop: at the end of the range, continue from its start (seamlessly, ahead of time).
      if (this.loop && (this.nextIndex >= notes.length || notes[this.nextIndex].t >= this.loop.to - 1e-6)) {
        const len = this.loop.to - this.loop.from;
        if (len <= 0) break;
        const loopEndTime = this.startTime + (this.loop.to - this.startT) / sp;
        if (loopEndTime > horizon) break;
        this.startTime = loopEndTime;
        this.startT = this.loop.from;
        this.nextIndex = notes.findIndex(x => x.t >= this.loop!.from - 1e-6);
        if (this.nextIndex < 0) break;
        continue;
      }
      if (this.nextIndex >= notes.length) break;
      const n = notes[this.nextIndex];
      const at = this.startTime + (n.t - this.startT) / sp;
      if (at > horizon) break;
      if (at >= ctx.currentTime - 0.02 && !this.mutedParts.has(n.part) && (this.partVolume[n.part] ?? 1) > 0) {
        const d = Math.max(0.05, n.dur / sp);
        this.voice(n, at, d);
        this.sounding.push({ part: n.part, from: at, to: at + d });
      }
      this.nextIndex++;
    }
    this.voices = this.voices.filter(v => v.end > ctx.currentTime);
  }

  /** Loudness 0..1 → gain. A musical range (pp about 9 dB under ff), never silent or blasting. */
  private static levelOf(vel: number) {
    const v = Math.max(0.15, Math.min(1, vel));
    return 0.62 * Math.pow(10, ((v - 0.8) * 20) / 20);   // pp ≈ -9 dB, ff ≈ 0 dB
  }

  private voice(n: PerfNote, at: number, dur: number) {
    const ctx = this.ctx!;
    const sound = this.soundOf(n.part);
    const set = this.samples.get(sound);
    if (!set || !Object.values(set).some(l => l.length)) { this.synthVoice(n, at, dur, sound); return; }
    const gain = ctx.createGain();
    const level = ScorePlayer.levelOf(n.vel) * (this.partVolume[n.part] ?? 1);
    const nodes: AudioScheduledSourceNode[] = [];
    let end: number;

    // Two recorded layers (soft/loud): blend them by loudness instead of jumping between them,
    // so the tone colour changes smoothly from note to note.
    const blend = set.soft?.length && set.loud?.length ? Math.max(0, Math.min(1, (n.vel - 0.35) / 0.4)) : null;
    const layers: { list: Sample[]; mix: number }[] = blend == null
      ? [{ list: (set.loud?.length ? set.loud : set.soft ?? Object.values(set)[0]), mix: 1 }]
      : [{ list: set.soft, mix: 1 - blend }, { list: set.loud, mix: blend }].filter(l => l.mix > 0.02);

    const nearest = (list: Sample[]) => {
      let best = list[0];
      for (const x of list) if (Math.abs(x.midi - n.midi) < Math.abs(best.midi - n.midi)) best = x;
      return best;
    };

    if (sound === 'piano') {
      // struck string: sounds until released (damper), then a short natural release
      gain.gain.setValueAtTime(level, at);
      const release = at + Math.max(dur, 0.12);
      gain.gain.setTargetAtTime(0, release, 0.09);
      end = release + 0.6;
      for (const l of layers) {
        const best = nearest(l.list);
        const src = ctx.createBufferSource();
        src.buffer = best.buf;
        src.playbackRate.value = Math.pow(2, (n.midi - best.midi) / 12);
        const g = ctx.createGain(); g.gain.value = l.mix;
        src.connect(g).connect(gain);
        src.start(at); src.stop(Math.min(at + best.buf.duration / src.playbackRate.value, end) + 0.05);
        nodes.push(src);
      }
    } else {
      // bowed: soft start, held, bow release. Long notes chain overlapping pieces of the steady
      // middle of the recording with crossfades (a plain loop clicks and wobbles).
      const attack = n.legato ? 0.04 : 0.07;
      end = at + dur + 0.5;
      // the "loud" recordings have a clean bow attack; the soft ones swell in slowly (and would
      // make every note start late by a different amount), so bowed notes always use loud ones
      const best = nearest(set.loud?.length ? set.loud : layers[0].list);
      const rate = Math.pow(2, (n.midi - best.midi) / 12);
      const bufDur = best.buf.duration / rate;           // real seconds of recording
      const xf = 0.25, startOff = best.off + 0.8;        // crossfade, where the steady part begins (buffer s)
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(level * best.norm, at + attack);
      gain.gain.setValueAtTime(level * best.norm, at + Math.max(attack, dur - 0.02));
      gain.gain.setTargetAtTime(0, at + dur, 0.08);
      let t = at, offset = best.off;
      for (let k = 0; t < end && k < 40; k++) {
        const src = ctx.createBufferSource();
        src.buffer = best.buf; src.playbackRate.value = rate;
        const g = ctx.createGain();
        const pieceLen = bufDur - offset / rate - 0.15;  // real seconds this piece can play
        if (k > 0) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + xf); }
        else g.gain.setValueAtTime(1, t);
        const pieceEnd = Math.min(end, t + pieceLen);
        if (pieceEnd < end) { g.gain.setValueAtTime(1, pieceEnd - xf); g.gain.linearRampToValueAtTime(0, pieceEnd); }
        src.connect(g).connect(gain);
        src.start(t, offset); src.stop(pieceEnd + 0.02);
        nodes.push(src);
        if (pieceEnd >= end || pieceLen <= xf * 2 + 0.2) break;
        t = pieceEnd - xf; offset = startOff;
      }
    }
    // the recordings carry their own natural vibrato: nothing is added on top
    gain.connect(this.dry!);
    gain.connect(this.wet!);
    this.voices.push({ nodes, gain, end });
  }

  // Fallback when the recordings are not available: a simple synthesized tone.
  private synthVoice(n: PerfNote, at: number, dur: number, sound: Sound) {
    const ctx = this.ctx!;
    const f = 440 * Math.pow(2, (n.midi - 69) / 12);
    const o = ctx.createOscillator(); o.type = sound === 'piano' ? 'triangle' : 'sawtooth'; o.frequency.value = f;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = Math.min(4000, f * 4);
    const gain = ctx.createGain();
    const level = 0.12 + 0.3 * n.vel;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.01);
    gain.gain.setTargetAtTime(0, at + dur, 0.08);
    o.connect(filt).connect(gain);
    gain.connect(this.dry!); gain.connect(this.wet!);
    const end = at + dur + 0.4;
    o.start(at); o.stop(end);
    this.voices.push({ nodes: [o], gain, end });
  }

  dispose() { this.stop(); void this.ctx?.close(); this.ctx = null; }
}
