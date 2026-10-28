// Web Audio instruments and a simple scheduler for playing note lists.
import { midiToFreq } from './notes.js';

/** Plucky synth bass: saw + sub sine through an enveloped low-pass filter. */
export function playBassNote(ctx, out, { midi, start, duration, velocity = 1 }) {
  const freq = midiToFreq(midi);
  const end = start + Math.max(0.08, duration);

  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = freq;
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = freq;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 6;
  filter.frequency.setValueAtTime(freq * 8, start);
  filter.frequency.exponentialRampToValueAtTime(freq * 1.5, start + 0.25);

  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.35;
  const amp = ctx.createGain();
  const peak = 0.5 * velocity;
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(peak, start + 0.008);
  amp.gain.setTargetAtTime(peak * 0.7, start + 0.01, 0.15);
  amp.gain.setTargetAtTime(0, end, 0.03);

  saw.connect(sawGain).connect(filter);
  sub.connect(filter);
  filter.connect(amp).connect(out);
  for (const osc of [saw, sub]) {
    osc.start(start);
    osc.stop(end + 0.2);
  }
}

/** Electric-piano style keys: a few decaying sine partials with a bell-ish attack. */
export function playKeysNote(ctx, out, { midi, start, duration, velocity = 1 }) {
  const freq = midiToFreq(midi);
  const end = start + Math.max(0.1, duration);
  const amp = ctx.createGain();
  const peak = 0.18 * velocity;
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(peak, start + 0.005);
  amp.gain.setTargetAtTime(peak * 0.45, start + 0.01, 0.4);
  amp.gain.setTargetAtTime(0, end, 0.08);
  amp.connect(out);

  const partials = [
    { ratio: 1, gain: 1, decay: 1.2 },
    { ratio: 2, gain: 0.35, decay: 0.5 },
    { ratio: 3, gain: 0.12, decay: 0.25 },
    { ratio: 14, gain: 0.05, decay: 0.03 }, // tine "clink"
  ];
  for (const p of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * p.ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(p.gain, start);
    g.gain.setTargetAtTime(p.gain * 0.2, start, p.decay);
    osc.connect(g).connect(amp);
    osc.start(start);
    osc.stop(end + 0.5);
  }
}

/**
 * Schedule parts on an AudioContext. Each part is { notes, play, gain }.
 * Returns a stop() function that silences everything scheduled.
 */
export function playParts(ctx, parts, { offset = 0.1 } = {}) {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const compressor = ctx.createDynamicsCompressor();
  master.connect(compressor).connect(ctx.destination);

  const t0 = ctx.currentTime + offset;
  for (const part of parts) {
    const bus = ctx.createGain();
    bus.gain.value = part.gain ?? 1;
    bus.connect(master);
    for (const note of part.notes) {
      part.play(ctx, bus, { ...note, start: t0 + note.start });
    }
  }
  return {
    startTime: t0,
    stop() {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      setTimeout(() => master.disconnect(), 200);
    },
  };
}
