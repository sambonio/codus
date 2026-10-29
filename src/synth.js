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

const impulses = new WeakMap();

/**
 * A synthetic room: stereo noise with a short pre-delay, decaying
 * exponentially and getting darker as it fades, like a mid-sized studio.
 */
export function roomImpulse(ctx, { seconds = 1.6, preDelay = 0.012 } = {}) {
  if (impulses.has(ctx)) return impulses.get(ctx);
  const rate = ctx.sampleRate;
  const length = Math.floor(seconds * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = Math.floor(preDelay * rate); i < length; i++) {
      const t = i / rate;
      // One-pole low-pass whose cutoff falls over time: highs die first.
      const coef = 0.6 * Math.exp(-t * 2.2) + 0.05;
      lp += coef * (Math.random() * 2 - 1 - lp);
      data[i] = lp * Math.exp((-6.9 * t) / seconds);
    }
  }
  impulses.set(ctx, buffer);
  return buffer;
}

/**
 * Schedule parts on an AudioContext. Each part is { id, notes, play, gain,
 * pan?, reverb?, release? }: pan is -1 (left) to 1 (right), reverb is the
 * send level into a shared room, and release(bus) frees anything the
 * instrument built for that part.
 * Returns { startTime, stop(), setGain(id, gain), setPan(id, pan) }.
 */
export function playParts(ctx, parts, { offset = 0.1 } = {}) {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  // Gentle glue compression on the mix, like a mastering bus.
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.02;
  compressor.release.value = 0.25;
  compressor.knee.value = 12;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.3;
  // Brick-wall-ish limiter so a dense chord can never clip the output.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  master.connect(compressor).connect(makeup).connect(limiter).connect(ctx.destination);

  const room = ctx.createConvolver();
  room.buffer = roomImpulse(ctx);
  room.connect(master);

  const t0 = ctx.currentTime + offset;
  const buses = new Map();
  const panners = new Map();
  for (const part of parts) {
    const bus = ctx.createGain();
    bus.gain.value = part.gain ?? 1;
    const panner = ctx.createStereoPanner();
    panner.pan.value = part.pan ?? 0;
    bus.connect(panner).connect(master);
    buses.set(part.id, bus);
    panners.set(part.id, panner);
    if (part.reverb) {
      const send = ctx.createGain();
      send.gain.value = part.reverb;
      bus.connect(send).connect(room);
    }
    for (const note of part.notes) {
      part.play(ctx, bus, { ...note, start: t0 + note.start });
    }
  }
  return {
    startTime: t0,
    setGain(id, gain) {
      buses.get(id)?.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
    },
    setPan(id, pan) {
      panners.get(id)?.pan.setTargetAtTime(pan, ctx.currentTime, 0.02);
    },
    stop() {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      setTimeout(() => {
        master.disconnect();
        for (const part of parts) part.release?.(buses.get(part.id));
      }, 200);
    },
  };
}
