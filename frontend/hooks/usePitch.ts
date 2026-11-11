import { useState, useEffect, useRef } from 'react';
import { detectPitch, freqToNote, medianOf, INSTRUMENTS, type InstrumentKey } from '../lib/pitch';

export interface PitchReading {
  note: string;
  octave: number;
  cents: number;
  freq: number;
  midi: number;
  clarity: number;
  active: boolean;
}

/**
 * Owns a single mic stream shared between tuner and pitch-trace panels.
 * Runs at 20 Hz via setInterval. Cleans up the stream when disabled.
 */
export function usePitch(
  enabled: boolean,
  instrument: InstrumentKey = 'violin',
  a4Ref = 440,
): { reading: PitchReading | null; error: string | null } {
  const [reading, setReading] = useState<PitchReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  // These can change without restarting the stream
  const a4Ref$ = useRef(a4Ref);
  useEffect(() => { a4Ref$.current = a4Ref; }, [a4Ref]);

  // Restart the stream when instrument changes (frequency range changes)
  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the reading when the tuner is turned off
      setReading(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        ctx.createMediaStreamSource(stream).connect(analyser);

        const preset = INSTRUMENTS[instrument];
        const buf = new Float32Array(analyser.fftSize);
        const freqHistory: number[] = [];

        timer = setInterval(() => {
          if (!analyser) return;
          analyser.getFloatTimeDomainData(buf);
          const { freq, clarity } = detectPitch(buf, ctx!.sampleRate, preset.minFreq, preset.maxFreq);

          if (clarity >= 0.90 && freq > 0) {
            freqHistory.push(freq);
            if (freqHistory.length > 5) freqHistory.shift();
            const smoothFreq = medianOf(freqHistory);
            if (smoothFreq > 0) {
              const noteData = freqToNote(smoothFreq, a4Ref$.current);
              setReading({ ...noteData, freq: smoothFreq, clarity, active: true });
            }
          } else {
            freqHistory.length = 0;
            setReading(r => r ? { ...r, active: false } : null);
          }
        }, 50); // 20 Hz
      } catch (err: unknown) {
        if (!cancelled) {
          const name = err instanceof Error ? err.name : '';
          setError(
            name === 'NotAllowedError' || name === 'PermissionDeniedError'
              ? 'Microphone access denied. Please allow mic access and try again.'
              : 'Could not access the microphone. Check that no other app is using it.',
          );
          console.warn('Microphone error:', err);
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close();
    };
   
  }, [enabled, instrument]); // a4Ref intentionally excluded — handled by ref

  return { reading, error };
}
