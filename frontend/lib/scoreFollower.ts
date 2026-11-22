// Score following: given the notes of the score and a stream of detected pitches from the
// microphone, keep track of where the player is.
//
// How it works (simple and robust for one instrument):
// - A new note is "heard" when the detected pitch settles on a new semitone, or the same pitch
//   comes back after a short silence (a repeated note).
// - It is matched against the next few expected notes (fast passages, where the microphone misses
//   notes, are fine). Octave mistakes of the detector are accepted.
// - After several notes that don't match, it looks further ahead and behind to find its place again
//   (the player skipped, restarted a passage, or played from another bar).
// - Notes held clearly out of tune are remembered, so they can be marked on the score.

import type { ScoreModel } from './musicxml';

export interface FollowEvent { beat: number; bar: number; midis: number[] }
export interface OffNote { bar: number; midi: number; cents: number }

const WINDOW = 8;          // how many notes ahead to look normally
const RESYNC_AFTER = 4;    // unmatched notes before searching widely
const OFF_CENTS = 20;      // more than this, held for OFF_MS, counts as out of tune
const OFF_MS = 250;

export class ScoreFollower {
  events: FollowEvent[];
  pos = 0;                         // index of the next expected event
  bar = 0;                         // bar of the last matched note
  misses = 0;
  recent: number[] = [];           // recent heard pitches (for re-syncing)
  off: OffNote[] = [];

  private lastMidi: number | null = null;
  private silentSince: number | null = null;
  private matched: { idx: number; midi: number; since: number; worst: number; recorded: boolean } | null = null;

  constructor(score: ScoreModel) {
    // Group notes that start together (chords / double stops) into one event.
    const evs: FollowEvent[] = [];
    for (const n of score.notes) {
      const last = evs[evs.length - 1];
      if (last && Math.abs(last.beat - n.beat) < 1e-4) last.midis.push(n.midi);
      else evs.push({ beat: n.beat, bar: n.bar, midis: [n.midi] });
    }
    this.events = evs;
  }

  /** Start following from a bar (1-based). */
  startAt(bar: number) {
    const i = this.events.findIndex(e => e.bar >= bar);
    this.pos = i < 0 ? 0 : i;
    this.bar = bar;
    this.misses = 0;
    this.recent = [];
    this.lastMidi = null;
    this.matched = null;
  }

  /**
   * Feed one reading (about 20 per second). `midi` and `cents` from the pitch detector,
   * `active` false when there is no clear pitch. Returns the current bar.
   */
  feed(r: { midi: number; cents: number; active: boolean }, now: number): number {
    if (!r.active) {
      if (this.silentSince == null) this.silentSince = now;
      if (now - this.silentSince > 120) { this.lastMidi = null; this.matched = null; }
      return this.bar;
    }
    this.silentSince = null;

    // Intonation of the note being held
    if (this.matched && this.matched.midi === r.midi) {
      const m = this.matched;
      if (Math.abs(r.cents) > Math.abs(m.worst)) m.worst = r.cents;
      if (!m.recorded && Math.abs(r.cents) > OFF_CENTS && now - m.since > OFF_MS) {
        m.recorded = true;
        this.off.push({ bar: this.events[m.idx].bar, midi: r.midi, cents: Math.round(r.cents) });
      }
    }

    if (r.midi === this.lastMidi) return this.bar; // same note still sounding
    this.lastMidi = r.midi;
    this.onNewNote(r.midi, now);
    return this.bar;
  }

  private matches(ev: FollowEvent, midi: number) {
    return ev.midis.some(m => m === midi || Math.abs(m - midi) === 12);
  }

  private onNewNote(midi: number, now: number) {
    this.recent.push(midi);
    if (this.recent.length > 6) this.recent.shift();

    // 1) the next few expected notes
    for (let k = 0; k < WINDOW && this.pos + k < this.events.length; k++) {
      const idx = this.pos + k;
      if (this.matches(this.events[idx], midi)) { this.accept(idx, midi, now); return; }
    }
    this.misses++;
    if (this.misses < RESYNC_AFTER) return;

    // 2) lost: find the place in the score that best fits the last few heard notes
    const seq = this.recent.slice(-4);
    let best = -1, bestScore = 0;
    for (let i = 0; i + seq.length <= this.events.length; i++) {
      let s = 0;
      for (let j = 0; j < seq.length; j++) if (this.matches(this.events[i + j], seq[j])) s++;
      // prefer places near where we were
      const score = s - Math.min(Math.abs(i - this.pos), 200) * 0.002;
      if (s >= Math.max(3, seq.length - 1) && score > bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) this.accept(best + seq.length - 1, midi, now);
  }

  private accept(idx: number, midi: number, now: number) {
    this.pos = idx + 1;
    this.bar = this.events[idx].bar;
    this.misses = 0;
    this.matched = { idx, midi, since: now, worst: 0, recorded: false };
  }

  done() { return this.pos >= this.events.length; }
  clearOff() { this.off = []; }
}
