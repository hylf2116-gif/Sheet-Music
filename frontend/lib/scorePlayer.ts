// Plays a ScoreModel in the browser with Web Audio (no downloads, starts instantly).
// Notes are scheduled slightly ahead of time so playback stays steady even when the page is busy.

import { midiToFreq, type ScoreModel } from './musicxml';

export type Instrument = 'piano' | 'cello' | 'erhu';

export class ScorePlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private nextIndex = 0;
  private startBeat = 0;     // score beat at which playback started
  private startTime = 0;     // audio time at which that beat sounds
  private voices: { osc: OscillatorNode[]; gain: GainNode; end: number }[] = [];
  private lastBar = -1;

  tempo = 80;                // quarter notes per minute
  instrument: Instrument = 'piano';
  mutedParts = new Set<number>();          // accompaniment: the student's part is silent
  loop: { from: number; to: number } | null = null; // beats; playback repeats this range
  playing = false;
  onBar: (bar: number) => void = () => {};
  onEnd: () => void = () => {};

  constructor(private score: ScoreModel) {}

  setScore(score: ScoreModel) { const was = this.playing; const at = this.currentBeat(); this.stop(); this.score = score; if (was) this.play(at); }

  /** Current position in beats (while playing). */
  currentBeat(): number {
    if (!this.playing || !this.ctx) return this.startBeat;
    const b = this.startBeat + (this.ctx.currentTime - this.startTime) * this.tempo / 60;
    // The loop restart is scheduled slightly ahead; until then we are still at the end of the range.
    if (this.loop && b < this.loop.from) return this.loop.to - (this.loop.from - b);
    return b;
  }

  /** Start at a bar (1-based) or at a beat. */
  play(fromBeat = 0) {
    this.stop();
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      // gentle room so the synth sounds less dry
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
    }
    void this.ctx.resume();
    this.playing = true;
    this.startBeat = fromBeat;
    this.startTime = this.ctx.currentTime + 0.08;
    this.nextIndex = this.score.notes.findIndex(n => n.beat >= fromBeat - 1e-6);
    if (this.nextIndex < 0) this.nextIndex = this.score.notes.length;
    this.lastBar = -1;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
    const tick = () => {
      if (!this.playing) return;
      const beat = this.currentBeat();
      const bar = this.barAt(beat);
      if (bar !== this.lastBar && bar > 0) { this.lastBar = bar; this.onBar(bar); }
      if (!this.loop && beat >= this.score.totalBeats + 0.25) { this.stop(); this.onEnd(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Loop bars from..to (inclusive, 1-based), or null to stop looping. */
  setLoopBars(range: { from: number; to: number } | null) {
    if (!range) { this.loop = null; return; }
    const a = this.score.bars.find(b => b.n === Math.min(range.from, range.to));
    const z = this.score.bars.find(b => b.n === Math.max(range.from, range.to));
    this.loop = a && z ? { from: a.beat, to: z.beat + z.beats } : null;
  }

  playFromBar(bar: number) {
    const b = this.score.bars.find(x => x.n === bar);
    this.play(b ? b.beat : 0);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.raf);
    if (this.playing && this.ctx) this.startBeat = this.currentBeat();
    this.playing = false;
    const now = this.ctx?.currentTime ?? 0;
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, 0.02);
        v.osc.forEach(o => o.stop(now + 0.1));
      } catch {}
    }
    this.voices = [];
  }

  /** Change speed without a jump: keep the current beat where it is. */
  setTempo(bpm: number) {
    if (!this.playing) { this.tempo = bpm; return; }
    const beat = this.currentBeat();
    this.stop();
    this.tempo = bpm;
    this.play(beat);
  }

  barAt(beat: number): number {
    const bars = this.score.bars;
    let lo = 0, hi = bars.length - 1, ans = bars.length ? bars[0].n : 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].beat <= beat + 1e-6) { ans = bars[mid].n; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    const horizon = ctx.currentTime + 0.2;
    const secPerBeat = 60 / this.tempo;
    const notes = this.score.notes;
    while (true) {
      // Loop: at the end of the range, continue from its start (seamlessly, ahead of time).
      if (this.loop && (this.nextIndex >= notes.length || notes[this.nextIndex].beat >= this.loop.to - 1e-6)) {
        const len = this.loop.to - this.loop.from;
        if (len <= 0) break;
        const loopEndTime = this.startTime + (this.loop.to - this.startBeat) * secPerBeat;
        if (loopEndTime > horizon) break;
        this.startTime = loopEndTime;
        this.startBeat = this.loop.from;
        this.nextIndex = notes.findIndex(x => x.beat >= this.loop!.from - 1e-6);
        if (this.nextIndex < 0) break;
        continue;
      }
      if (this.nextIndex >= notes.length) break;
      const n = notes[this.nextIndex];
      const t = this.startTime + (n.beat - this.startBeat) * secPerBeat;
      if (t > horizon) break;
      if (t >= ctx.currentTime - 0.02 && !this.mutedParts.has(n.part ?? 0)) this.voice(n.midi, t, Math.max(0.06, n.dur * secPerBeat));
      this.nextIndex++;
    }
    this.voices = this.voices.filter(v => v.end > ctx.currentTime);
  }

  private voice(midi: number, t: number, dur: number) {
    const ctx = this.ctx!, out = this.master!;
    const f = midiToFreq(midi);
    const gain = ctx.createGain();
    const oscs: OscillatorNode[] = [];
    let end = t + dur;

    if (this.instrument === 'piano') {
      // struck string: bright attack that decays, two slightly detuned partials
      for (const [type, mult, level] of [['triangle', 1, 0.6], ['sine', 2, 0.18], ['sine', 3, 0.06]] as const) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mult;
        const g = ctx.createGain(); g.gain.value = level; o.connect(g).connect(gain); oscs.push(o);
      }
      const decay = Math.min(2.5, 0.4 + 300 / f);
      end = t + Math.max(dur, 0.25) + 0.3;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.5, t + 0.005);
      gain.gain.setTargetAtTime(0.0001, t + 0.01, decay / 4);
      gain.gain.setTargetAtTime(0, t + Math.max(dur, 0.25), 0.08);
    } else {
      // bowed string: sawtooth through a filter, soft attack, vibrato after the start
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; oscs.push(o);
      const filt = ctx.createBiquadFilter();
      if (this.instrument === 'erhu') { filt.type = 'bandpass'; filt.frequency.value = Math.min(4000, f * 3); filt.Q.value = 1.6; }
      else { filt.type = 'lowpass'; filt.frequency.value = Math.min(3500, f * 4); filt.Q.value = 0.7; }
      o.connect(filt).connect(gain);
      const lfo = ctx.createOscillator(); lfo.frequency.value = this.instrument === 'erhu' ? 6 : 5.2;
      const depth = ctx.createGain(); depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * (this.instrument === 'erhu' ? 0.012 : 0.006), t + Math.min(0.35, dur));
      lfo.connect(depth).connect(o.frequency); oscs.push(lfo);
      const level = this.instrument === 'erhu' ? 0.32 : 0.3;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + Math.min(0.06, dur / 3));
      gain.gain.setValueAtTime(level * 0.85, t + Math.max(0.07, dur - 0.05));
      gain.gain.linearRampToValueAtTime(0, t + dur + 0.04);
      end = t + dur + 0.06;
    }
    gain.connect(out);
    oscs.forEach(o => { o.start(t); o.stop(end + 0.05); });
    this.voices.push({ osc: oscs, gain, end });
  }

  dispose() { this.stop(); void this.ctx?.close(); this.ctx = null; }
}
