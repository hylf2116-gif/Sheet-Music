// Pure pitch-detection utilities — no React, no browser APIs.

export const INSTRUMENTS = {
  cello:  { label: 'Cello',  minFreq: 60,   maxFreq: 1050, strings: [{ note: 'C2', freq: 65.41 }, { note: 'G2', freq: 98.00 }, { note: 'D3', freq: 146.83 }, { note: 'A3', freq: 220.00 }] },
  violin: { label: 'Violin', minFreq: 185,  maxFreq: 3300, strings: [{ note: 'G3', freq: 196.00 }, { note: 'D4', freq: 293.66 }, { note: 'A4', freq: 440.00 }, { note: 'E5', freq: 659.25 }] },
  erhu:   { label: 'Erhu',   minFreq: 280,  maxFreq: 2050, strings: [{ note: 'D4', freq: 293.66 }, { note: 'A4', freq: 440.00 }] },
  voice:  { label: 'Voice',  minFreq: 75,   maxFreq: 1100, strings: [] as { note: string; freq: number }[] },
  custom: { label: 'Custom', minFreq: 50,   maxFreq: 2050, strings: [] as { note: string; freq: number }[] },
} as const;

export type InstrumentKey = keyof typeof INSTRUMENTS;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function freqToNote(freq: number, a4 = 440): { note: string; octave: number; cents: number; midi: number } {
  const rawMidi = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(rawMidi);
  const cents = Math.round((rawMidi - midi) * 100);
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return { note: NOTE_NAMES[noteIndex], octave, cents, midi };
}

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Median of non-zero values. Returns 0 if no data. */
export function medianOf(values: number[]): number {
  const v = values.filter(x => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * YIN pitch detection with parabolic interpolation.
 * Returns { freq (Hz), clarity (0–1) }.
 * clarity ≥ 0.9 and freq > 0 means a confident reading.
 */
export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  minFreq = 50,
  maxFreq = 2000,
  threshold = 0.10,
): { freq: number; clarity: number } {
  const W = Math.floor(buffer.length / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(W - 1, Math.ceil(sampleRate / minFreq));

  // Volume gate — silence returns immediately
  let rmsSum = 0;
  for (let i = 0; i < buffer.length; i++) rmsSum += buffer[i] * buffer[i];
  if (Math.sqrt(rmsSum / buffer.length) < 0.008) return { freq: 0, clarity: 0 };

  // Step 2: difference function d[τ] for τ in 1..tauMax
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    for (let j = 0; j < W; j++) {
      const diff = buffer[j] - buffer[j + tau];
      d[tau] += diff * diff;
    }
  }

  // Step 3: cumulative mean normalized difference (CMND)
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let runSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runSum += d[tau];
    cmnd[tau] = runSum > 0 ? (d[tau] * tau) / runSum : 1;
  }

  // Step 4: first τ ≥ tauMin where CMND dips below threshold, then descend to local min
  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }

  // Fallback: absolute minimum in range (low confidence)
  if (tau === -1) {
    let minV = Infinity;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cmnd[t] < minV) { minV = cmnd[t]; tau = t; }
    }
    if (tau === -1 || cmnd[tau] > 0.5) return { freq: 0, clarity: 0 };
  }

  // Step 5: parabolic interpolation for sub-sample accuracy
  let betterTau = tau;
  if (tau > 1 && tau < tauMax) {
    const s0 = cmnd[tau - 1], s1 = cmnd[tau], s2 = cmnd[tau + 1];
    const denom = 2 * s1 - s0 - s2;
    if (Math.abs(denom) > 1e-7) {
      const shift = (s0 - s2) / (2 * denom);
      betterTau = tau + Math.max(-0.5, Math.min(0.5, shift));
    }
  }

  return { freq: sampleRate / betterTau, clarity: 1 - cmnd[tau] };
}
