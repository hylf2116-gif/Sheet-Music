// Reads a Standard MIDI File (.mid) into the same ScoreModel as MusicXML, so playback, looping and
// score following work the same way. Tracks (or channels, in single-track files) become parts.
// Bars come from the time signature; the first tempo in the file is used as the score tempo.

import type { ScoreModel, ScoreNote, ScoreBar } from './musicxml';

class Reader {
  pos = 0;
  constructor(private d: DataView) {}
  u8() { return this.d.getUint8(this.pos++); }
  u16() { const v = this.d.getUint16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.d.getUint32(this.pos); this.pos += 4; return v; }
  str(n: number) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }
  varlen() { let v = 0; for (let i = 0; i < 4; i++) { const b = this.u8(); v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return v; }
}

interface RawNote { tick: number; endTick: number; midi: number; key: string }

export function parseMidi(buf: ArrayBuffer): ScoreModel {
  const r = new Reader(new DataView(buf));
  if (r.str(4) !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = r.u32();
  const format = r.u16();
  const ntracks = r.u16();
  const division = r.u16();
  r.pos = 8 + hlen;
  if (division & 0x8000) throw new Error('This MIDI file uses SMPTE timing, which is not supported');
  const tpq = division; // ticks per quarter note

  let tempo: number | null = null;
  const timeSigs: { tick: number; beats: number }[] = [];   // beats = quarter notes per bar
  const byPart = new Map<string, RawNote[]>();
  const names = new Map<string, string>();

  for (let t = 0; t < ntracks && r.pos < buf.byteLength; t++) {
    if (r.str(4) !== 'MTrk') break;
    const len = r.u32();
    const end = r.pos + len;
    let tick = 0, status = 0, trackName = '';
    const open = new Map<string, RawNote[]>(); // channel:note -> notes still sounding
    while (r.pos < end) {
      tick += r.varlen();
      let b = r.u8();
      if (b === 0xff) {                       // meta event
        const type = r.u8(); const l = r.varlen(); const start = r.pos;
        if (type === 0x51 && l === 3 && tempo == null) {
          const us = (r.u8() << 16) | (r.u8() << 8) | r.u8();
          tempo = Math.round(60_000_000 / us);
        } else if (type === 0x58 && l >= 2) {
          const nn = r.u8(), dd = r.u8();
          timeSigs.push({ tick, beats: nn * 4 / Math.pow(2, dd) });
        } else if (type === 0x03) {
          trackName = r.str(l).trim();
        }
        r.pos = start + l;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) { r.pos += r.varlen(); continue; } // sysex
      if (b & 0x80) status = b; else { r.pos--; b = status; }          // running status
      const kind = status & 0xf0, ch = status & 0x0f;
      if (kind === 0x90 || kind === 0x80) {
        const note = r.u8(), vel = r.u8();
        // Format 0 keeps everything in one track: split it by channel instead.
        const key = format === 0 ? `c${ch}` : `t${t}`;
        const slot = `${ch}:${note}`;
        if (kind === 0x90 && vel > 0) {
          const n: RawNote = { tick, endTick: tick, midi: note, key };
          if (!byPart.has(key)) byPart.set(key, []);
          byPart.get(key)!.push(n);
          if (!open.has(slot)) open.set(slot, []);
          open.get(slot)!.push(n);
        } else {
          const q = open.get(slot);
          const n = q?.shift();
          if (n) n.endTick = tick;
        }
      } else if (kind === 0xc0 || kind === 0xd0) r.pos += 1;
      else r.pos += 2;
    }
    r.pos = end;
    if (trackName) names.set(format === 0 ? '' : `t${t}`, trackName);
  }

  // Parts in a stable order, skipping drum channel 10 in single-track files
  const keys = [...byPart.keys()].filter(k => k !== 'c9');
  const parts = keys.map((k, i) => names.get(k) || (k.startsWith('c') ? `Channel ${Number(k.slice(1)) + 1}` : `Part ${i + 1}`));
  const lastTick = Math.max(0, ...keys.flatMap(k => byPart.get(k)!.map(n => Math.max(n.endTick, n.tick + 1))));

  // Bars from time signatures (4/4 if none)
  timeSigs.sort((a, b) => a.tick - b.tick);
  const bars: ScoreBar[] = [];
  let tickPos = 0, sigIdx = 0, beatsPerBar = timeSigs.length && timeSigs[0].tick === 0 ? timeSigs[0].beats : 4;
  while (tickPos < lastTick || bars.length === 0) {
    while (sigIdx < timeSigs.length && timeSigs[sigIdx].tick <= tickPos) beatsPerBar = timeSigs[sigIdx++].beats;
    bars.push({ n: bars.length + 1, beat: tickPos / tpq, beats: beatsPerBar });
    tickPos += beatsPerBar * tpq;
  }
  const barAt = (beat: number) => {
    let lo = 0, hi = bars.length - 1, ans = 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].beat <= beat + 1e-6) { ans = bars[m].n; lo = m + 1; } else hi = m - 1; }
    return ans;
  };

  const notes: ScoreNote[] = [];
  keys.forEach((k, part) => {
    for (const n of byPart.get(k)!) {
      const beat = n.tick / tpq;
      notes.push({ beat, dur: Math.max(n.endTick - n.tick, tpq / 8) / tpq, midi: n.midi, bar: barAt(beat), part });
    }
  });
  notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  const last = bars[bars.length - 1];
  return { notes, bars, tempo, totalBeats: last.beat + last.beats, parts };
}
