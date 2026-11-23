// Reads a MusicXML score (as produced by the score recognition) into a simple timeline:
// every note with its start and length in beats (quarter notes), its pitch, and its bar.
// Used by playback and by score following.

export interface ScoreNote {
  beat: number;       // start, in quarter notes from the beginning
  dur: number;        // length in quarter notes
  midi: number;       // MIDI pitch (60 = middle C)
  bar: number;        // bar number, 1-based and sequential through the score (same as the bar boxes)
  part?: number;      // which part/instrument (index into ScoreModel.parts)
}
export interface ScoreBar { n: number; beat: number; beats: number }
export interface ScoreModel {
  notes: ScoreNote[];
  bars: ScoreBar[];
  tempo: number | null;   // quarter notes per minute, if the score says
  totalBeats: number;
  parts?: string[];       // part names (e.g. "Cello", "Piano"), when known
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Written note values in quarter notes.
const TYPE_BEATS: Record<string, number> = {
  maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5,
  '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125,
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

const num = (el: Element | null | undefined, sel: string, fallback = 0) => {
  const v = el?.querySelector(sel)?.textContent;
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function parseMusicXml(xml: string): ScoreModel {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Could not read the score');

  const notes: ScoreNote[] = [];
  const barsByIndex: ScoreBar[] = [];
  let tempo: number | null = null;

  const partNames = new Map<string, string>();
  for (const sp of Array.from(doc.querySelectorAll('part-list > score-part'))) {
    partNames.set(sp.getAttribute('id') ?? '', sp.querySelector('part-name')?.textContent?.trim() || '');
  }
  const parts: string[] = [];
  for (const part of Array.from(doc.querySelectorAll('score-partwise > part'))) {
    const partIndex = parts.length;
    parts.push(partNames.get(part.getAttribute('id') ?? '') || `Part ${partIndex + 1}`);
    let divisions = 1;
    let beatsPerBar = 4;
    let barStart = 0;
    const measures = Array.from(part.children).filter(c => c.tagName === 'measure');
    measures.forEach((m, i) => {
      let pos = 0;          // position inside the bar, in divisions
      let maxPos = 0;
      let lastStart = 0;    // start of the previous note (for chords)
      // Pending ties: midi -> note waiting to be extended
      const tied = new Map<number, ScoreNote>();
      // One voice in this bar: trust the written note values over the recognized duration numbers.
      const singleVoice = !Array.from(m.children).some(c => c.tagName === 'backup' || c.tagName === 'forward');

      for (const el of Array.from(m.children)) {
        const tag = el.tagName;
        if (tag === 'attributes') {
          divisions = num(el, 'divisions', divisions) || divisions;
          const b = num(el, 'time > beats', 0), bt = num(el, 'time > beat-type', 0);
          if (b && bt) beatsPerBar = b * 4 / bt;
        } else if (tag === 'direction' || tag === 'sound') {
          const s = tag === 'sound' ? el : el.querySelector('sound');
          const tv = s?.getAttribute('tempo');
          if (tv && tempo == null && Number(tv) > 0) tempo = Number(tv);
        } else if (tag === 'backup') {
          pos -= num(el, 'duration');
        } else if (tag === 'forward') {
          pos += num(el, 'duration');
          maxPos = Math.max(maxPos, pos);
        } else if (tag === 'note') {
          if (el.querySelector('grace')) continue; // grace notes take no time
          const wb = singleVoice ? writtenBeats(el) : null;
          const d = wb != null ? wb * divisions : num(el, 'duration');
          const isChord = !!el.querySelector('chord');
          const start = isChord ? lastStart : pos;
          if (!isChord) { lastStart = pos; pos += d; maxPos = Math.max(maxPos, pos); }
          if (el.querySelector('rest')) continue;
          const p = el.querySelector('pitch');
          if (!p) continue;
          const step = p.querySelector('step')?.textContent?.trim() ?? 'C';
          const midi = 12 * (num(p, 'octave', 4) + 1) + (STEP[step] ?? 0) + num(p, 'alter', 0);
          const beat = barStart + start / divisions;
          const dur = d / divisions;
          const ties = Array.from(el.querySelectorAll('tie')).map(t => t.getAttribute('type'));
          const prev = tied.get(midi);
          if (ties.includes('stop') && prev) {
            prev.dur = beat + dur - prev.beat; // extend the held note
            if (!ties.includes('start')) tied.delete(midi);
            continue;
          }
          const note: ScoreNote = { beat, dur, midi, bar: i + 1, part: partIndex };
          notes.push(note);
          if (ties.includes('start')) tied.set(midi, note);
        }
      }
      // A bar lasts as long as its time signature, unless it is a pickup / incomplete bar.
      const filled = maxPos / divisions;
      const length = filled > 0 && filled < beatsPerBar - 1e-6 && (i === 0 || m.getAttribute('implicit') === 'yes')
        ? filled : Math.max(beatsPerBar, filled);
      if (!barsByIndex[i]) barsByIndex[i] = { n: i + 1, beat: barStart, beats: length };
      barStart += length;
    });
  }

  notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  const bars = barsByIndex.filter(Boolean);
  const last = bars[bars.length - 1];
  return { notes, bars, tempo, totalBeats: last ? last.beat + last.beats : 0, parts };
}

export function midiToFreq(midi: number) { return 440 * Math.pow(2, (midi - 69) / 12); }
