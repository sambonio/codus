// Tonewheel organ (Hammond B3 style) with C3 chorus, overdrive and a
// two-rotor Leslie 122 speaker, all in Web Audio.

// Drawbar footages as multiples of the 16' sub-octave:
// 16', 5 1/3', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1'.
export const DRAWBAR_HARMONICS = [1, 3, 2, 4, 6, 8, 10, 12, 16];
const TOP_TONEWHEEL_HZ = 5900; // drawbars above the top wheel fold back an octave

export const ORGAN_PRESETS = {
  gospel: { name: 'Organ: gospel', drawbars: [8, 8, 8, 8, 0, 0, 0, 0, 0], percussion: null, drive: 0.35, chorus: true },
  jazz: { name: 'Organ: jazz', drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0], percussion: { harmonic: 3, decay: 0.12 }, drive: 0.15, chorus: true },
  rock: { name: 'Organ: rock', drawbars: [8, 8, 8, 4, 0, 0, 0, 0, 0], percussion: null, drive: 0.85, chorus: true },
  soft: { name: 'Organ: soft ballad', drawbars: [0, 0, 8, 6, 0, 0, 0, 0, 0], percussion: null, drive: 0.05, chorus: true },
  full: { name: 'Organ: full', drawbars: [8, 8, 8, 8, 8, 8, 8, 8, 8], percussion: null, drive: 0.4, chorus: true },
};

/** Each drawbar step is about 3 dB; 0 is off. */
export function drawbarGain(level) {
  return level <= 0 ? 0 : Math.pow(10, (-3 * (8 - level)) / 20);
}

/**
 * Harmonic amplitudes (indexed by multiple of half the note frequency) for
 * a drawbar registration, with foldback above the top tonewheel.
 */
export function organSpectrum(freq, drawbars) {
  const amps = new Float32Array(17);
  drawbars.forEach((level, i) => {
    let h = DRAWBAR_HARMONICS[i];
    while ((freq / 2) * h > TOP_TONEWHEEL_HZ && h % 2 === 0) h /= 2;
    amps[h] += drawbarGain(level);
  });
  return amps;
}

// Leslie rotor speeds (Hz) and how fast they get there (time constants, s).
const ROTORS = {
  horn: { slow: 0.83, fast: 6.7, spinUp: 0.35, spinDown: 0.6, doppler: 0.00045, am: 0.55, crossover: 'highpass' },
  drum: { slow: 0.7, fast: 5.9, spinUp: 1.6, spinDown: 2.4, doppler: 0.0002, am: 0.3, crossover: 'lowpass' },
};

// A sine LFO with a phase offset (radians), built from a one-harmonic wave.
function phasedLfo(ctx, phase) {
  const real = new Float32Array([0, Math.sin(phase)]);
  const imag = new Float32Array([0, Math.cos(phase)]);
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
  return osc;
}

function driveCurve(amount) {
  const curve = new Float32Array(2048);
  const k = 1 + amount * 6;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    // Asymmetric tanh, like a tube preamp, for a little even-harmonic warmth.
    curve[i] = Math.tanh(k * x + 0.1 * amount * x * x) / Math.tanh(k);
  }
  return curve;
}

/**
 * Build the organ's effect chain into `out`: chorus, overdrive, Leslie.
 * Returns { input, setSpeed(speed, when) }.
 */
function buildChain(ctx, out, preset, speed) {
  const input = ctx.createGain();
  const lfos = [];

  // C3 scanner chorus: a vibrato'd copy mixed with the dry signal.
  const chorusOut = ctx.createGain();
  input.connect(chorusOut);
  if (preset.chorus) {
    const delay = ctx.createDelay(0.01);
    delay.delayTime.value = 0.0015;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.9;
    const depth = ctx.createGain();
    depth.gain.value = 0.00012;
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start();
    lfos.push(lfo);
    input.connect(delay).connect(chorusOut);
    chorusOut.gain.value = 0.6;
  }

  // Preamp overdrive, then tame the fizz like a tube amp's top end.
  const preGain = ctx.createGain();
  preGain.gain.value = 1 + preset.drive * 2.5;
  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(preset.drive);
  shaper.oversample = '4x';
  const postGain = ctx.createGain();
  postGain.gain.value = 1 / (1 + preset.drive * 1.6);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 7000 - preset.drive * 2500;
  chorusOut.connect(preGain).connect(shaper).connect(postGain).connect(tone);

  // Leslie: treble horn and bass drum rotors, each heard by two mics.
  const merger = ctx.createChannelMerger(2);
  const output = ctx.createGain();
  output.gain.value = 0.35;
  merger.connect(output).connect(out);
  const speedParams = [];
  for (const rotor of Object.values(ROTORS)) {
    const split = ctx.createBiquadFilter();
    split.type = rotor.crossover;
    split.frequency.value = 800;
    split.Q.value = 0.5;
    tone.connect(split);
    // Mics 120 degrees apart around the cabinet.
    [0, (2 * Math.PI) / 3].forEach((phase, channel) => {
      const lfo = phasedLfo(ctx, phase);
      lfo.frequency.value = rotor[speed];
      speedParams.push({ param: lfo.frequency, rotor });

      const delay = ctx.createDelay(0.02);
      delay.delayTime.value = 0.004;
      const dopplerDepth = ctx.createGain();
      dopplerDepth.gain.value = rotor.doppler;
      lfo.connect(dopplerDepth).connect(delay.delayTime);

      const am = ctx.createGain();
      am.gain.value = 1 - rotor.am / 2;
      const amDepth = ctx.createGain();
      amDepth.gain.value = rotor.am / 2;
      lfo.connect(amDepth).connect(am.gain);

      split.connect(delay).connect(am).connect(merger, 0, channel);
      lfo.start();
      lfos.push(lfo);
    });
  }

  return {
    input,
    dispose() {
      for (const lfo of lfos) lfo.stop();
      output.disconnect();
    },
    setSpeed(next, when = ctx.currentTime) {
      for (const { param, rotor } of speedParams) {
        param.cancelScheduledValues(when);
        param.setValueAtTime(param.value, when);
        param.setTargetAtTime(rotor[next], when, next === 'fast' ? rotor.spinUp : rotor.spinDown);
      }
    },
  };
}

let noiseBuffer = null;
function clickNoise(ctx) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// Key contacts closing (and opening) make a short bright click.
function keyClick(ctx, out, when, level) {
  const src = ctx.createBufferSource();
  src.buffer = clickNoise(ctx);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2500 + Math.random() * 1500;
  band.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, when);
  g.gain.setTargetAtTime(0, when, 0.0025);
  src.connect(band).connect(g).connect(out);
  src.start(when, Math.random() * 0.03);
  src.stop(when + 0.02);
}

/**
 * Create an organ instrument for a preset. The Leslie and chorus are shared
 * by every note sent to the same output, like one organ and one speaker.
 */
export function createOrgan(presetId = 'gospel') {
  const preset = ORGAN_PRESETS[presetId];
  const chains = new WeakMap(); // output node -> { chain, held }
  let speed = 'slow';
  const live = new Set();

  function chainFor(ctx, out) {
    let entry = chains.get(out);
    if (!entry) {
      entry = { chain: buildChain(ctx, out, preset, speed), held: [] };
      chains.set(out, entry);
      live.add(entry.chain);
    }
    return entry;
  }

  return {
    name: preset.name,
    reverb: 0.2,
    controls: [{ id: 'leslie', label: 'Leslie', options: [['slow', 'Slow'], ['fast', 'Fast']] }],
    get leslie() { return speed; },
    set leslie(next) {
      speed = next;
      for (const chain of live) chain.setSpeed(next);
    },
    // Free the Leslie and chorus built for an output once playback is over.
    release(out) {
      const entry = chains.get(out);
      if (!entry) return;
      entry.chain.dispose();
      live.delete(entry.chain);
      chains.delete(out);
    },
    play(ctx, out, { midi, start, duration, velocity = 0.8 }) {
      const { chain, held } = chainFor(ctx, out);
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const end = start + Math.max(0.06, duration);

      // Tonewheels spin freely, so every harmonic gets its own phase.
      const amps = organSpectrum(freq, preset.drawbars);
      // Pulling out more drawbars makes the organ louder, but not linearly.
      const total = amps.reduce((a, b) => a + b, 0);
      const norm = 1 / Math.max(1, Math.sqrt(total) * 1.5);
      const real = new Float32Array(amps.length);
      const imag = new Float32Array(amps.length);
      for (let h = 1; h < amps.length; h++) {
        const phase = Math.random() * 2 * Math.PI;
        real[h] = amps[h] * norm * Math.sin(phase);
        imag[h] = amps[h] * norm * Math.cos(phase);
      }
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
      osc.frequency.value = freq / 2;

      // An organ has no velocity: keys are on or off. A few ms of contact bounce.
      const amp = ctx.createGain();
      const level = 0.11;
      amp.gain.setValueAtTime(0, start);
      amp.gain.linearRampToValueAtTime(level, start + 0.003);
      amp.gain.setTargetAtTime(0, end, 0.006);
      osc.connect(amp).connect(chain.input);
      osc.start(start);
      osc.stop(end + 0.08);

      keyClick(ctx, chain.input, start, 0.05);
      keyClick(ctx, chain.input, end, 0.02);

      // Single-trigger percussion: only when no other key is already down.
      const alreadyHeld = held.some((n) => n.start < start - 0.01 && n.end > start);
      held.push({ start, end });
      if (held.length > 64) held.splice(0, held.length - 64);
      if (preset.percussion && !alreadyHeld) {
        const perc = ctx.createOscillator();
        perc.frequency.value = freq * preset.percussion.harmonic;
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(0, start);
        pg.gain.linearRampToValueAtTime(0.05 * (0.7 + 0.3 * velocity), start + 0.002);
        pg.gain.setTargetAtTime(0, start + 0.002, preset.percussion.decay);
        pg.gain.setTargetAtTime(0, end, 0.006);
        perc.connect(pg).connect(chain.input);
        perc.start(start);
        perc.stop(Math.min(end, start + preset.percussion.decay * 8) + 0.05);
      }
    },
  };
}
