// Sample-based instruments: one recorded note per semitone, decoded on demand.

export const SAMPLED_BASSES = {
  upright: { dir: 'acoustic_bass', low: 33, high: 57, release: 0.07, level: 0.55 },
  electric: { dir: 'electric_bass_finger', low: 33, high: 57, release: 0.04, level: 0.5 },
};

const SAMPLES_ROOT = new URL('../samples/', import.meta.url);
const loaded = new WeakMap(); // AudioContext -> Map(name -> Promise<Map(midi -> sample)>)

/**
 * Trim the silence before the attack and work out a gain that brings every
 * note to the same peak level, so the line sounds even across the neck.
 */
function prepare(buffer) {
  const data = buffer.getChannelData(0);
  let peak = 1e-6;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  let onset = 0;
  while (onset < data.length && Math.abs(data[onset]) < peak * 0.02) onset++;
  const preRoll = Math.floor(buffer.sampleRate * 0.001);
  return { buffer, offset: Math.max(0, onset - preRoll) / buffer.sampleRate, gain: 1 / peak };
}

/** Fetch and decode every note of a sampled instrument. Safe to call repeatedly. */
export function loadSampledBass(ctx, name) {
  const spec = SAMPLED_BASSES[name];
  if (!spec) return Promise.reject(new Error(`Unknown bass: ${name}`));
  let byName = loaded.get(ctx);
  if (!byName) loaded.set(ctx, (byName = new Map()));
  if (!byName.has(name)) {
    const notes = [];
    for (let midi = spec.low; midi <= spec.high; midi++) {
      notes.push(
        fetch(new URL(`${spec.dir}/${midi}.mp3`, SAMPLES_ROOT))
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${spec.dir}/${midi}.mp3`);
            return res.arrayBuffer();
          })
          .then((bytes) => ctx.decodeAudioData(bytes))
          .then((buffer) => [midi, prepare(buffer)]),
      );
    }
    const promise = Promise.all(notes).then((entries) => new Map(entries));
    promise.catch(() => byName.delete(name)); // allow a retry after a network error
    byName.set(name, promise);
  }
  return byName.get(name);
}

/**
 * Make a play function for an already-loaded instrument. Notes outside the
 * sampled range are pitch-shifted from the nearest sample.
 */
export function sampledBassPlayer(name, samples) {
  const spec = SAMPLED_BASSES[name];
  return (ctx, out, { midi, start, duration, velocity = 1 }) => {
    const nearest = Math.min(spec.high, Math.max(spec.low, midi));
    const sample = samples.get(nearest);
    if (!sample) return;
    const end = start + Math.max(0.1, duration);

    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = Math.pow(2, (midi - nearest) / 12);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(spec.level * sample.gain * (0.55 + 0.45 * velocity), start);
    // Damp the string when the note ends, smoothly so there's no click.
    amp.gain.setTargetAtTime(0, end, spec.release);

    source.connect(amp).connect(out);
    source.start(start, sample.offset);
    source.stop(end + spec.release * 8);
  };
}
