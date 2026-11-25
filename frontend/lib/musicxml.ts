// Reads a MusicXML score (recognized or imported) into a timeline: every note with its start and
// length in beats (quarter notes), pitch, bar, loudness and articulation, plus the tempo changes,
// repeats and endings needed to play it back like a musician would (see performance.ts).
// Used by playback and by score following.

export interface ScoreNote {
  beat: number;       // start, in quarter notes from the beginning (written order, no repeats)
  dur: number;        // length in quarter notes
  midi: number;       // MIDI pitch (60 = middle C)
  bar: number;        // bar number, 1-based and sequential through the score (same as the bar boxes)
  part?: number;      // which part/instrument (index into ScoreModel.parts)
  vel?: number;       // loudness 0..1 (from dynamics / MIDI velocity)
  staccato?: boolean; staccatissimo?: boolean; accent?: boolean; tenuto?: boolean;
  fermata?: boolean;
  strongAccent?: boolean;     // marcato
  slur?: 'in' | 'end';        // under a slur (played connected); 'end' = last note of the slur
  breath?: boolean;           // breath mark / lift after the note
  caesura?: boolean;          // a short silence after the note
  trill?: number;             // trill: semitones to the upper note
  tremolo?: number;           // single-note tremolo strokes (1 = eighths, 2 = 16ths, 3 = 32nds)
  arpeggio?: boolean;         // chord rolled from the bottom
  grace?: 'acciaccatura' | 'appoggiatura'; // played just before the main note (dur = 0 in the score)
}
export interface ScoreBar {
  n: number; beat: number; beats: number;
  repeatStart?: boolean;       // |:
  repeatEnd?: number;          // :|  (times to play, usually 2)
  ending?: number[];           // first/second ending numbers this bar belongs to
  repaired?: boolean;          // recognition read the wrong length here; notes were fitted to the bar
  segno?: boolean;             // 𝄋 (D.S. jumps back here)
  coda?: boolean;              // 𝄌 the coda starts here
  toCoda?: boolean;            // "To Coda": after the D.C./D.S. jump, skip to the coda from here
  fine?: boolean;              // Fine: after the D.C./D.S. jump, the piece ends here
  jump?: 'dc' | 'ds';          // D.C. / D.S. at the end of this bar
}
export interface TempoMark { beat: number; bpm: number }
export interface ScoreModel {
  notes: ScoreNote[];
  bars: ScoreBar[];
  tempo: number | null;   // first tempo (quarter notes per minute), if the score says
  tempos?: TempoMark[];   // every tempo change, in written beats
  totalBeats: number;
  parts?: string[];       // part names (e.g. "Cello", "Piano"), when known
  partInfo?: { clef?: string; staves: number }[]; // first clef sign (G/F/C) and staff count per part
  // MIDI already has performance timing (no repeats to expand)
  performed?: boolean;
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Written note values in quarter notes.
const TYPE_BEATS: Record<string, number> = {
  maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5,
  '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125,
};
// Dynamic marks → loudness
// Kept within a musical range: each step is clearly different, ff is full but not a shock.
const DYN: Record<string, number> = {
  pppp: 0.24, ppp: 0.28, pp: 0.33, p: 0.41, mp: 0.5, mf: 0.58, f: 0.67, ff: 0.76, fff: 0.83, ffff: 0.88,
};
// One-note accents: they make that note loud, the general level stays (fp: loud, then soft).
const ONE_NOTE: Record<string, { hit: number; after?: number }> = {
  // hit = how much louder than the current level that one note is (added, then capped)
  sf: { hit: 0.16 }, sfz: { hit: 0.18 }, sffz: { hit: 0.22 }, fz: { hit: 0.16 }, rfz: { hit: 0.12 }, rf: { hit: 0.12 },
  sfp: { hit: 0.18, after: DYN.p }, fp: { hit: 0.14, after: DYN.p }, sfzp: { hit: 0.18, after: DYN.p },
};
// Tempo words (when the score gives no number), in quarter notes per minute.
const TEMPO_WORDS: [RegExp, number][] = [
  [/grave/i, 40], [/largo|慢板/i, 50], [/larghetto/i, 60], [/lento/i, 56], [/adagietto/i, 72], [/adagio/i, 66],
  [/andantino/i, 88], [/andante|行板/i, 80], [/moderato|中板|中速/i, 100], [/allegretto|小快板/i, 112],
  [/vivace|活泼/i, 150], [/presto|急板/i, 172], [/prestissimo/i, 200], [/allegro|快板/i, 132],
];
interface TempoEvent { beat: number; kind: 'set' | 'rit' | 'accel' | 'back'; bpm?: number }
// Beat units for metronome marks, in quarter notes.
const UNIT: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 };

const num = (el: Element | null | undefined, sel: string, fallback = 0) => {
  const v = el?.querySelector(sel)?.textContent;
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// The written length of a note (type, dots, tuplets). Recognition sometimes misreads the
// <duration> number while the note shape (<type>) is right, so this is the more reliable value.
function writtenBeats(note: Element): number | null {
  const type = note.querySelector('type')?.textContent?.trim();
  if (!type || !(type in TYPE_BEATS)) return null;
  let b = TYPE_BEATS[type];
  let add = b;
  for (let i = 0; i < note.querySelectorAll('dot').length; i++) { add /= 2; b += add; }
  const actual = num(note, 'time-modification > actual-notes', 0);
  const normal = num(note, 'time-modification > normal-notes', 0);
  if (actual > 0 && normal > 0) b = b * normal / actual;
  return b;
}

export function parseMusicXml(xml: string): ScoreModel {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Could not read the score');

  const notes: ScoreNote[] = [];
  const barsByIndex: ScoreBar[] = [];
  const tempoEvents: TempoEvent[] = [];
  const partNames = new Map<string, string>();
  for (const sp of Array.from(doc.querySelectorAll('part-list > score-part'))) {
    partNames.set(sp.getAttribute('id') ?? '', sp.querySelector('part-name')?.textContent?.trim() || '');
  }
  const parts: string[] = [];
  const partInfo: { clef?: string; staves: number }[] = [];

  for (const part of Array.from(doc.querySelectorAll('score-partwise > part'))) {
    const partIndex = parts.length;
    parts.push(partNames.get(part.getAttribute('id') ?? '') || `Part ${partIndex + 1}`);
    partInfo.push({
      clef: part.querySelector('attributes clef sign')?.textContent?.trim(),
      staves: num(part.querySelector('attributes staves')?.parentElement, 'staves', 1) || 1,
    });
    let divisions = 1;
    let beatsPerBar = 4;
    let barStart = 0;
    let vel = DYN.mf;                       // current loudness for this part
    let hit: { hit: number; after?: number } | null = null; // sf / fp waiting for its note
    const slurs = new Set<string>();        // open slur numbers
    // crescendo / diminuendo in progress: from which beat, and which way
    let wedge: { start: number; from: number; dir: 1 | -1 } | null = null;
    const wedgeNotes: ScoreNote[] = [];
    const tied = new Map<number, ScoreNote>(); // midi -> note waiting to be extended (ties cross bars)
    const measures = Array.from(part.children).filter(c => c.tagName === 'measure');

    measures.forEach((m, i) => {
      // every part follows the first part's bar grid (a part that rests for a page stays in step)
      if (barsByIndex[i]) barStart = barsByIndex[i].beat;
      let pos = 0;          // position inside the bar, in divisions
      let maxPos = 0;
      let lastStart = 0;    // start of the previous note (for chords)
      const singleVoice = !Array.from(m.children).some(c => c.tagName === 'backup' || c.tagName === 'forward');
      const barInfo: ScoreBar = { n: i + 1, beat: barStart, beats: 0 };
      const pendingGrace: ScoreNote[] = [];
      const firstNote = notes.length;   // notes of this bar start here (for the rhythm repair below)

      // A big step up with no crescendo written (the AI reader never writes hairpins): grow into it
      // over the two beats before, as a player would, instead of jumping.
      const setLevel = (atBeat: number, to: number) => {
        if (!wedge && to - vel >= 0.15) {
          for (let k = notes.length - 1; k >= 0; k--) {
            const n = notes[k];
            if (n.part !== partIndex) continue;
            if (n.beat < atBeat - 2) break;
            const f = Math.max(0, Math.min(1, (n.beat - (atBeat - 2)) / 2));
            n.vel = (n.vel ?? vel) + (to - (n.vel ?? vel)) * f * 0.75;
          }
        }
        vel = to;
      };
      const endWedge = (atBeat: number, target?: number) => {
        if (!wedge) return;
        const to = target ?? Math.max(0.15, Math.min(1, wedge.from + 0.2 * wedge.dir));
        const span = Math.max(1e-6, atBeat - wedge.start);
        for (const n of wedgeNotes) n.vel = wedge.from + (to - wedge.from) * Math.min(1, (n.beat - wedge.start) / span);
        vel = to; wedge = null; wedgeNotes.length = 0;
      };

      for (const el of Array.from(m.children)) {
        const tag = el.tagName;
        const here = barStart + pos / divisions;
        if (tag === 'attributes') {
          divisions = num(el, 'divisions', divisions) || divisions;
          const b = num(el, 'time > beats', 0), bt = num(el, 'time > beat-type', 0);
          if (b && bt) beatsPerBar = b * 4 / bt;
        } else if (tag === 'direction' || tag === 'sound') {
          const s = tag === 'sound' ? el : el.querySelector('sound');
          const tv = Number(s?.getAttribute('tempo'));
          if (partIndex === 0) {
            const words = Array.from(el.querySelectorAll('words')).map(w => w.textContent ?? '').join(' ').trim();
            const met = el.querySelector('metronome');
            const unit = UNIT[met?.querySelector('beat-unit')?.textContent?.trim() ?? ''];
            const per = Number(met?.querySelector('per-minute')?.textContent);
            const dotted = !!met?.querySelector('beat-unit-dot');
            if (tv > 0) tempoEvents.push({ beat: here, kind: 'set', bpm: tv });
            else if (unit && per > 0) tempoEvents.push({ beat: here, kind: 'set', bpm: per * unit * (dotted ? 1.5 : 1) });
            if (words) {
              if (/\b(rit|ritard|rall|allarg|calando|morendo|smorz)|渐慢/i.test(words)) tempoEvents.push({ beat: here, kind: 'rit' });
              else if (/\b(accel|stringendo|string\.)|渐快/i.test(words)) tempoEvents.push({ beat: here, kind: 'accel' });
              else if (/a\s*tempo|tempo\s*(i|primo|1)\b|原速/i.test(words)) tempoEvents.push({ beat: here, kind: 'back' });
              else if (!(tv > 0) && !(unit && per > 0)) {
                const w = TEMPO_WORDS.find(([re]) => re.test(words));
                if (w) tempoEvents.push({ beat: here, kind: 'set', bpm: w[1] * (/molto|assai/i.test(words) && w[1] > 100 ? 1.1 : 1) * (/poco|ma non troppo|non troppo/i.test(words) ? 0.93 : 1) });
              }
            }
          }
          const dynAttr = Number(s?.getAttribute('dynamics'));
          const dynEl = el.querySelector('dynamics > *');
          const dname = dynEl?.tagName ?? '';
          if (ONE_NOTE[dname]) hit = ONE_NOTE[dname];
          else if (DYN[dname] != null) { endWedge(here, DYN[dname]); setLevel(here, DYN[dname]); }
          else if (!dynEl && dynAttr > 0) { const v = Math.max(0.2, Math.min(0.95, dynAttr * 0.9 / 127)); endWedge(here, v); vel = v; }
          const wd = el.querySelector('wedge');
          const wt = wd?.getAttribute('type');
          if (wt === 'crescendo' || wt === 'diminuendo') wedge = { start: here, from: vel, dir: wt === 'crescendo' ? 1 : -1 };
          else if (wt === 'stop') endWedge(here);
        }
        // Road map marks (segno, coda, D.C., D.S., Fine, To Coda): as symbols, words or <sound>
        if (tag === 'direction' || tag === 'sound' || tag === 'barline') {
          const snd = tag === 'sound' ? el : el.querySelector('sound');
          const w = Array.from(el.querySelectorAll('words')).map(x => x.textContent ?? '').join(' ').trim();
          if (el.querySelector('segno') || snd?.hasAttribute('segno')) barInfo.segno = true;
          const hasCodaSign = !!el.querySelector('coda') || snd?.hasAttribute('coda');
          if (snd?.hasAttribute('tocoda') || /to\s*coda|al\s*coda.*⊕|^⊕$/i.test(w)) barInfo.toCoda = true;
          else if (hasCodaSign || /^coda\b/i.test(w)) barInfo.coda = true;
          if (snd?.hasAttribute('fine') || /^fine\b/i.test(w)) barInfo.fine = true;
          if (snd?.getAttribute('dacapo') === 'yes' || /\bd\.?\s*c\.?(\s|$)|da\s*capo/i.test(w)) barInfo.jump = 'dc';
          if (snd?.hasAttribute('dalsegno') || /\bd\.?\s*s\.?(\s|$)|dal\s*segno/i.test(w)) barInfo.jump = 'ds';
        }
        if (tag === 'barline') {
          const rep = el.querySelector('repeat');
          if (rep?.getAttribute('direction') === 'forward') barInfo.repeatStart = true;
          if (rep?.getAttribute('direction') === 'backward') barInfo.repeatEnd = Number(rep.getAttribute('times')) || 2;
          const end = el.querySelector('ending');
          const nums = end?.getAttribute('number');
          if (nums && (end?.getAttribute('type') === 'start' || !barInfo.ending)) {
            barInfo.ending = nums.split(/[,\s]+/).map(Number).filter(n => n > 0);
          }
        } else if (tag === 'backup') {
          pos -= num(el, 'duration');
        } else if (tag === 'forward') {
          pos += num(el, 'duration');
          maxPos = Math.max(maxPos, pos);
        } else if (tag === 'note') {
          const p = el.querySelector('pitch');
          const step = p?.querySelector('step')?.textContent?.trim() ?? 'C';
          const midi = p ? 12 * (num(p, 'octave', 4) + 1) + (STEP[step] ?? 0) + num(p, 'alter', 0) : 0;
          const graceEl = el.querySelector('grace');
          if (graceEl) {
            // grace notes take no written time: they are placed just before the next main note
            if (p) pendingGrace.push({
              beat: 0, dur: 0, midi, bar: i + 1, part: partIndex, vel,
              grace: graceEl.getAttribute('slash') === 'yes' ? 'acciaccatura' : 'appoggiatura',
            });
            continue;
          }
          const wb = singleVoice ? writtenBeats(el) : null;
          const d = wb != null ? wb * divisions : num(el, 'duration');
          const isChord = !!el.querySelector('chord');
          const start = isChord ? lastStart : pos;
          if (!isChord) { lastStart = pos; pos += d; maxPos = Math.max(maxPos, pos); }
          if (el.querySelector('rest') || !p) continue;
          const beat = barStart + start / divisions;
          const dur = d / divisions;
          const ties = Array.from(el.querySelectorAll('tie')).map(t => t.getAttribute('type'));
          const prev = tied.get(midi);
          if (ties.includes('stop') && prev) {
            prev.dur = beat + dur - prev.beat; // extend the held note
            if (!ties.includes('start')) tied.delete(midi);
            continue;
          }
          const art = el.querySelector('notations > articulations');
          const orn = el.querySelector('notations > ornaments');
          // dynamics written on the note itself
          const nd = el.querySelector('notations > dynamics > *')?.tagName ?? '';
          if (ONE_NOTE[nd]) hit = ONE_NOTE[nd]; else if (DYN[nd] != null) { endWedge(beat, DYN[nd]); setLevel(beat, DYN[nd]); }
          // slurs: a note is "in" a slur from the start note up to and including the stop note
          const slurEls = Array.from(el.querySelectorAll('notations > slur'));
          for (const sl of slurEls) if (sl.getAttribute('type') === 'start') slurs.add(sl.getAttribute('number') ?? '1');
          const stops = slurEls.filter(sl => sl.getAttribute('type') === 'stop');
          const slur: ScoreNote['slur'] = stops.length ? 'end' : slurs.size ? 'in' : undefined;
          for (const sl of stops) slurs.delete(sl.getAttribute('number') ?? '1');
          let noteVel = vel;
          if (hit && !isChord) { noteVel = Math.min(0.84, vel + hit.hit); if (hit.after != null) vel = hit.after; hit = null; }
          else if (isChord) noteVel = notes[notes.length - 1]?.vel ?? vel;
          const accMark = orn?.querySelector('accidental-mark')?.textContent ?? '';
          const tremEl = orn?.querySelector('tremolo');
          const note: ScoreNote = {
            beat, dur, midi, bar: i + 1, part: partIndex, vel: noteVel,
            ...(slur ? { slur } : {}),
            ...(art?.querySelector('strong-accent') ? { strongAccent: true } : {}),
            ...(art?.querySelector('breath-mark') ? { breath: true } : {}),
            ...(art?.querySelector('caesura') ? { caesura: true } : {}),
            ...(orn?.querySelector('trill-mark') ? { trill: /flat/.test(accMark) ? 1 : 2 } : {}),
            ...(tremEl && (tremEl.getAttribute('type') ?? 'single') === 'single' ? { tremolo: Number(tremEl.textContent) || 3 } : {}),
            ...(el.querySelector('notations > arpeggiate') ? { arpeggio: true } : {}),
            ...(art?.querySelector('staccato') ? { staccato: true } : {}),
            ...(art?.querySelector('staccatissimo, spiccato') ? { staccatissimo: true } : {}),
            ...(art?.querySelector('accent') ? { accent: true } : {}),
            ...(art?.querySelector('detached-legato') ? { staccato: true, slur: 'in' as const } : {}),
            ...(art?.querySelector('tenuto') ? { tenuto: true } : {}),
            ...(el.querySelector('notations > fermata') ? { fermata: true } : {}),
          };
          for (const g of pendingGrace.splice(0)) notes.push({ ...g, beat });
          notes.push(note);
          if (wedge) wedgeNotes.push(note);
          if (ties.includes('start')) tied.set(midi, note);
        }
      }
      // A bar lasts as long as its time signature, unless it is a pickup / incomplete bar.
      const filled = maxPos / divisions;
      const pickup = filled > 0 && filled < beatsPerBar - 1e-6 && (i === 0 || m.getAttribute('implicit') === 'yes');
      // Rhythm repair: recognition often reads a bar a little too long or too short (a missed dot,
      // tuplet or beam). Played as read, the music stalls or leaves a hole. Squeeze/stretch the bar's
      // notes to fill exactly one bar instead, so the pulse stays steady.
      const ratio = filled > 0 ? beatsPerBar / filled : 1;
      if (!pickup && Math.abs(ratio - 1) > 1e-6 && ratio > 0.6 && ratio < 1.5 && i < measures.length - 1) {
        for (let k = firstNote; k < notes.length; k++) {
          const n = notes[k];
          if (n.bar !== i + 1 || n.part !== partIndex) continue;
          n.beat = barStart + (n.beat - barStart) * ratio;
          n.dur *= ratio;
        }
        barInfo.repaired = true;
        barInfo.beats = beatsPerBar;
      } else {
        barInfo.beats = pickup ? filled : Math.max(beatsPerBar, filled);
      }
      const existing = barsByIndex[i];
      if (!existing) barsByIndex[i] = barInfo;
      else { // other parts may carry the repeat signs too
        existing.repeatStart ||= barInfo.repeatStart;
        existing.repeatEnd ||= barInfo.repeatEnd;
        existing.ending ||= barInfo.ending;
        existing.repaired ||= barInfo.repaired;
        existing.segno ||= barInfo.segno; existing.coda ||= barInfo.coda; existing.toCoda ||= barInfo.toCoda;
        existing.fine ||= barInfo.fine; existing.jump ||= barInfo.jump;
      }
      barStart += barInfo.beats;
    });
    if (wedge) for (const n of wedgeNotes) n.vel = vel;
  }

  notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  const bars = barsByIndex.filter(Boolean);
  const last = bars[bars.length - 1];
  const tempos = buildTempos(tempoEvents, last ? last.beat + last.beats : 0, bars);
  return {
    notes, bars, tempo: tempos[0]?.bpm ?? null, tempos,
    totalBeats: last ? last.beat + last.beats : 0, parts, partInfo,
  };
}

/** Turn tempo marks into a tempo map. rit./accel. change gradually (in small steps) until the next
 *  mark or a few bars on; "a tempo" goes back to the tempo before the change. */
function buildTempos(events: TempoEvent[], total: number, bars: ScoreBar[]): TempoMark[] {
  events.sort((a, b) => a.beat - b.beat);
  const out: TempoMark[] = [];
  let cur = 0, base = 0;   // current and "a tempo" speed (0 = not known yet)
  const firstSet = events.find(e => e.kind === 'set')?.bpm;
  for (let k = 0; k < events.length; k++) {
    const e = events[k];
    if (e.kind === 'set' && e.bpm) { cur = base = e.bpm; out.push({ beat: e.beat, bpm: e.bpm }); continue; }
    if (e.kind === 'back') { if (base) { cur = base; out.push({ beat: e.beat, bpm: base }); } continue; }
    const from = cur || base || firstSet || 80;
    // ramp until the next mark, or two bars on, at most to the end
    const barLen = bars.find(b => b.beat <= e.beat && e.beat < b.beat + b.beats)?.beats ?? 4;
    const until = Math.min(events[k + 1]?.beat ?? Infinity, e.beat + barLen * 2, total);
    const to = from * (e.kind === 'rit' ? 0.72 : 1.25);
    const steps = Math.max(1, Math.round((until - e.beat) / 0.5));
    for (let j = 0; j < steps; j++) out.push({ beat: e.beat + (until - e.beat) * j / steps, bpm: from + (to - from) * (j + 1) / steps });
    cur = to;
    if (!base) base = from;
  }
  return out.sort((a, b) => a.beat - b.beat);
}

export function midiToFreq(midi: number) { return 440 * Math.pow(2, (midi - 69) / 12); }
