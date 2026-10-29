// Web Audio instruments and a simple scheduler for playing note lists.
import { midiToFreq } from './notes.js';

let saturationCurve = null;
function softClipCurve() {
  if (!saturationCurve) {
    saturationCurve = new Float32Array(1024);
    for (let i = 0; i < saturationCurve.length; i++) {
      const x = (i / (saturationCurve.length - 1)) * 2 - 1;
      saturationCurve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5);
    }
  }
  return saturationCurve;
}

/**
 * Analog-style synth bass: two slightly detuned saws plus a sine for weight,
 * through a filter whose sweep never closes below the audible range, then
 * gentle saturation so the line still reads on laptop and phone speakers.
 */
export function playSynthBassNote(ctx, out, { midi, start, duration, velocity = 1 }) {
  const freq = midiToFreq(midi);
  const end = start + Math.max(0.1, duration);
  const stopAt = end + 0.3;

  const mix = ctx.createGain();
  mix.gain.value = 0.5;
  const oscillators = [];
  for (const [type, detune, level] of [['sawtooth', -7, 0.45], ['sawtooth', 7, 0.45], ['sine', 0, 0.9]]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(mix);
    oscillators.push(osc);
  }

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 1.2;
  const open = Math.min(5000, freq * 14 + 600 * velocity);
  const closed = Math.max(260, freq * 4);
  filter.frequency.setValueAtTime(open, start);
  filter.frequency.setTargetAtTime(closed, start + 0.005, 0.09);

  const drive = ctx.createWaveShaper();
  drive.curve = softClipCurve();
  drive.oversample = '2x';

  const amp = ctx.createGain();
  const peak = 0.45 * (0.5 + 0.5 * velocity);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(peak, start + 0.006);
  amp.gain.setTargetAtTime(peak * 0.75, start + 0.006, 0.2);
  amp.gain.setTargetAtTime(0, end, 0.04);

  mix.connect(filter).connect(drive).connect(amp).connect(out);
  for (const osc of oscillators) {
    osc.start(start);
    osc.stop(stopAt);
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
