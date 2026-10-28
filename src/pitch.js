// Monophonic pitch detection using the YIN algorithm
// (de Cheveigné & Kawahara, 2002). Pure functions, no browser APIs.

/**
 * Estimate the fundamental frequency of one frame.
 * Returns { freq, clarity } or null when no confident pitch is found.
 */
export function yin(frame, sampleRate, { threshold = 0.15, minFreq = 50, maxFreq = 1000 } = {}) {
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), Math.floor(frame.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  if (maxLag <= minLag) return null;

  // Step 2: difference function.
  const diff = new Float32Array(maxLag + 1);
  const window = frame.length - maxLag;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const d = frame[i] - frame[i + lag];
      sum += d * d;
    }
    diff[lag] = sum;
  }

  // Step 3: cumulative mean normalized difference.
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    running += diff[lag];
    cmnd[lag] = running === 0 ? 1 : (diff[lag] * lag) / running;
  }

  // Step 4: absolute threshold, then walk down to the local minimum.
  let tau = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (cmnd[lag] < threshold) {
      while (lag + 1 <= maxLag && cmnd[lag + 1] < cmnd[lag]) lag++;
      tau = lag;
      break;
    }
  }
  if (tau === -1) return null;

  // Step 5: parabolic interpolation for sub-sample accuracy.
  let betterTau = tau;
  if (tau > 1 && tau < maxLag) {
    const s0 = cmnd[tau - 1], s1 = cmnd[tau], s2 = cmnd[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tau + (s2 - s0) / denom;
  }

  return { freq: sampleRate / betterTau, clarity: 1 - cmnd[tau] };
}

export function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Run pitch detection across a whole recording.
 * Returns { hopSeconds, frames: [{ time, freq|null, rms }] }.
 */
export function detectPitchTrack(samples, sampleRate, {
  frameSize = 2048,
  hopSize = 512,
  silenceRms = 0.01,
  ...yinOptions
} = {}) {
  // Gate relative to the loudest part so quiet mics still work.
  let peakRms = 0;
  const levels = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const level = rms(samples.subarray(start, start + frameSize));
    levels.push(level);
    if (level > peakRms) peakRms = level;
  }
  const gate = Math.max(silenceRms, peakRms * 0.08);

  const frames = levels.map((level, idx) => {
    const start = idx * hopSize;
    const time = (start + frameSize / 2) / sampleRate;
    if (level < gate) return { time, freq: null, rms: level };
    const result = yin(samples.subarray(start, start + frameSize), sampleRate, yinOptions);
    return { time, freq: result ? result.freq : null, rms: level };
  });

  return { hopSeconds: hopSize / sampleRate, frames };
}

/**
 * Cheap integer-factor decimation (box filter + pick) to speed up analysis.
 * Humming sits well below 1 kHz, so ~16 kHz is plenty.
 */
export function downsample(samples, sampleRate, targetRate = 16000) {
  const factor = Math.max(1, Math.floor(sampleRate / targetRate));
  if (factor === 1) return { samples, sampleRate };
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
    out[i] = sum / factor;
  }
  return { samples: out, sampleRate: sampleRate / factor };
}
