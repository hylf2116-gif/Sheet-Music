// Turns a written score (ScoreModel) into a performance: the order the bars are actually played
// (repeats, first/second endings), real times in seconds from the tempo marks, fermatas held,
// note lengths shaped by articulation, grace notes placed just before their main note.
// Times are at the score's own tempo; playback scales them by the speed the person picks.

import type { ScoreModel, ScoreNote } from './musicxml';

export interface PerfNote {
  t: number;        // start, seconds
  dur: number;      // sounding length, seconds
  midi: number;
  vel: number;      // 0..1
  bar: number;      // written bar number (for highlighting)
  part: number;
  legato: boolean;  // connected to the previous note of the same part (for slides on bowed sounds)
  end: number;      // where the written note ends, seconds (before articulation shortening)
}
export interface PerfBar { n: number; t: number; dur: number }
export interface Performance {
  notes: PerfNote[];
  bars: PerfBar[];     // in playing order (a repeated bar appears twice)
  total: number;       // seconds
  baseBpm: number;     // the score's first tempo
}

const DEFAULT_BPM = 80;

/** The order bars are played in: repeats, 1st/2nd endings, then D.C. / D.S. (back to the start
 *  or the segno), "To Coda" (jump to the coda) and Fine (stop). After a D.C./D.S. jump, repeats
 *  are not taken again (the usual convention). Returns bar indexes. */
export function playOrder(model: ScoreModel): number[] {
  const bars = model.bars;
  if (model.performed) return bars.map((_, i) => i);
  const order: number[] = [];
  const segnoAt = bars.findIndex(b => b.segno);
  const codaAt = bars.findIndex(b => b.coda);
  let i = 0, start = 0, pass = 1, inEnding = false, guard = 0;
  let jumped = false;            // a D.C. / D.S. has been taken
  while (i < bars.length && guard++ < 20000) {
    const b = bars[i];
    if (!jumped) {
      if (b.repeatStart && i !== start) { start = i; pass = 1; }
      if (b.ending) {
        inEnding = true;
        if (!b.ending.includes(pass)) { i++; continue; }   // not this time through
      } else if (inEnding) {                               // left the endings: next section
        inEnding = false; pass = 1; start = i;
      }
    } else if (b.ending && b.ending.length && Math.min(...b.ending) === 1 && bars.some(x => x.ending && Math.max(...x.ending) > 1)) {
      i++; continue;                                       // after D.C./D.S.: take the last ending
    }
    order.push(i);
    if (jumped && b.fine) break;                           // Fine: the end
    if (jumped && b.toCoda && codaAt >= 0) { i = codaAt; continue; }
    if (!jumped && b.jump) {                               // D.C. / D.S.
      jumped = true; inEnding = false;
      i = b.jump === 'ds' && segnoAt >= 0 ? segnoAt : 0;
      continue;
    }
    if (!jumped) {
      if (b.repeatEnd && pass < b.repeatEnd) { pass++; i = start; inEnding = false; continue; } // jump back: not "leaving" the endings
      if (b.repeatEnd && !b.ending) { pass = 1; start = i + 1; }
      // a movement ends here: a later repeat sign without a start sign goes back only to here
      else if (b.sectionEnd && !b.repeatEnd) { pass = 1; start = i + 1; }
    }
    i++;
  }
  return order;
}

export function buildPerformance(model: ScoreModel): Performance {
  const baseBpm = model.tempo ?? model.tempos?.[0]?.bpm ?? DEFAULT_BPM;
  const tempos = (model.tempos?.length ? model.tempos : [{ beat: 0, bpm: baseBpm }]).slice().sort((a, b) => a.beat - b.beat);
  // seconds between two written beats, following the tempo marks
  const secs = (from: number, to: number) => {
    if (to <= from) return 0;
    let s = 0, cur = from;
    let k = 0;
    while (k + 1 < tempos.length && tempos[k + 1].beat <= cur + 1e-9) k++;
    while (cur < to - 1e-9) {
      const bpm = tempos[k]?.bpm ?? baseBpm;
      const next = k + 1 < tempos.length ? Math.min(to, tempos[k + 1].beat) : to;
      s += (next - cur) * 60 / bpm;
      cur = next; k++;
    }
    return s;
  };

  // notes grouped by written bar
  const byBar = new Map<number, ScoreNote[]>();
  for (const n of model.notes) {
    if (!byBar.has(n.bar)) byBar.set(n.bar, []);
    byBar.get(n.bar)!.push(n);
  }

  const out: PerfNote[] = [];
  const bars: PerfBar[] = [];
  let t = 0;
  for (const idx of playOrder(model)) {
    const bar = model.bars[idx];
    const notes = (byBar.get(bar.n) ?? []).filter(n => !n.grace);
    const graces = (byBar.get(bar.n) ?? []).filter(n => n.grace);
    // fermatas: the music waits after the held note
    const holds = [
      ...notes.filter(n => n.fermata).map(n => ({ at: n.beat + n.dur, extra: secs(n.beat, n.beat + n.dur) * 0.8 })),
      ...notes.filter(n => n.caesura).map(n => ({ at: n.beat + n.dur, extra: 0.35 })),
    ];
    const holdBefore = (beat: number) => holds.reduce((s, h) => s + (h.at <= beat + 1e-6 ? h.extra : 0), 0);
    const tOf = (beat: number) => t + secs(bar.beat, beat) + holdBefore(beat);

    // chords marked to be rolled: lowest note first
    const rollAt = new Map<number, number[]>();
    for (const n of notes) if (n.arpeggio) { const k = n.beat * 1000 + (n.part ?? 0); if (!rollAt.has(k)) rollAt.set(k, []); rollAt.get(k)!.push(n.midi); }

    for (const n of notes) {
      let start = tOf(n.beat);
      let len = secs(n.beat, n.beat + n.dur);
      if (n.fermata) len += secs(n.beat, n.beat + n.dur) * 0.8;
      // articulation shapes the sounding length; plain notes have a tiny gap so repeats are heard
      let f = n.staccatissimo ? 0.3 : n.staccato ? (n.slur ? 0.75 : 0.5) : n.tenuto ? 1.0
        : n.slur === 'in' ? 1.0 : n.slur === 'end' ? 0.88 : 0.93;
      if (n.breath) f = Math.min(f, Math.max(0.5, 1 - 0.18 / Math.max(0.2, len)));
      // loudness: dynamics, accents, and a slight lean on the first beat of the bar
      let vel = (n.vel ?? 0.62) + (n.strongAccent ? 0.14 : n.accent ? 0.09 : 0);
      if (Math.abs(n.beat - bar.beat) < 1e-6 && !n.accent && !n.strongAccent) vel += 0.03;
      vel = Math.min(1, vel);
      const roll = rollAt.get(n.beat * 1000 + (n.part ?? 0));
      if (roll) start += [...roll].sort((a, b) => a - b).indexOf(n.midi) * 0.035;
      const base = { midi: n.midi, vel, bar: bar.n, part: n.part ?? 0, legato: false };
      if (n.trill && len > 0.15) {
        // trill: alternate with the upper note, about 12 notes a second
        const each = Math.max(0.06, len / Math.max(2, Math.round(len / 0.085)));
        for (let k = 0, tt = start; tt < start + len - 1e-6; k++, tt += each) {
          out.push({ ...base, t: tt, dur: each, midi: n.midi + (k % 2 ? n.trill : 0), vel: vel * (k ? 0.9 : 1), legato: k > 0, end: tt + each });
        }
        continue;
      }
      if (n.tremolo && len > 0.1) {
        // tremolo: repeat the note in quick strokes (eighths, 16ths, 32nds)
        const strokeBeats = Math.pow(0.5, n.tremolo);
        const count = Math.max(2, Math.round(n.dur / strokeBeats));
        const each = len / count;
        for (let k = 0; k < count; k++) out.push({ ...base, t: start + k * each, dur: each * 0.9, vel: vel * (k ? 0.92 : 1), end: start + (k + 1) * each });
        continue;
      }
      out.push({ ...base, t: start, dur: Math.max(0.04, len * f), end: start + len });
    }
    // grace notes: quick notes just before their main note
    const graceGroups = new Map<number, ScoreNote[]>();
    for (const g of graces) { if (!graceGroups.has(g.beat)) graceGroups.set(g.beat, []); graceGroups.get(g.beat)!.push(g); }
    for (const [beat, gs] of graceGroups) {
      const main = tOf(beat);
      gs.forEach((g, k) => {
        const each = g.grace === 'acciaccatura' ? 0.06 : 0.1;
        const gt = Math.max(0, main - each * (gs.length - k));
        out.push({ t: gt, dur: each, midi: g.midi, vel: (g.vel ?? 0.62) * 0.85, bar: bar.n, part: g.part ?? 0, legato: false, end: gt + each });
      });
    }
    const dur = secs(bar.beat, bar.beat + bar.beats) + holds.reduce((s, h) => s + h.extra, 0);
    bars.push({ n: bar.n, t, dur });
    t += dur;
  }

  out.sort((a, b) => a.t - b.t || a.midi - b.midi);
  // Chords: several notes struck together shouldn't add up to a shout. Each note of a k-note
  // chord is a little softer, so a 4-note piano chord sits with a single violin line.
  for (let i = 0; i < out.length;) {
    let j = i;
    while (j < out.length && Math.abs(out[j].t - out[i].t) < 0.02) j++;
    const byPart = new Map<number, PerfNote[]>();
    for (let k = i; k < j; k++) { const list = byPart.get(out[k].part) ?? []; list.push(out[k]); byPart.set(out[k].part, list); }
    for (const list of byPart.values()) if (list.length > 1) {
      const f = Math.pow(1 / Math.sqrt(list.length), 0.7);
      for (const n of list) n.vel *= f;
    }
    i = j;
  }
  // legato: a note that starts right where the previous note of its part ends (for bowed slides)
  const lastEnd = new Map<number, { end: number; midi: number }>();
  for (const n of out) {
    const prev = lastEnd.get(n.part);
    if (prev && Math.abs(prev.end - n.t) < 0.03 && prev.midi !== n.midi) n.legato = true;
    lastEnd.set(n.part, { end: n.end, midi: n.midi });
  }
  return { notes: out, bars, total: t, baseBpm };
}
