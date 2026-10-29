// Recorded audio tracks ("takes"): drums, guitar, vocals or anything else
// played into the mic in time with the song, and played back alongside the
// generated tracks.
//
// A take is a song track (see src/song.js) with role 'audio' and no notes:
//   { id, name, role: 'audio', kind, samples, sampleRate, offset, nudge,
//     volume, pan, muted, solo, notes: [] }
// `samples` is mono Float32 audio that starts `offset` seconds into the song
// (song time 0 is the start of the first section), and `nudge` is in
// milliseconds for fine-tuning the timing by ear.
import { encodeWav } from './wav.js';

export const TAKE_KINDS = {
  drums: 'Drums',
  percussion: 'Percussion',
  guitar: 'Guitar',
  vocals: 'Vocals',
  other: 'Instrument',
};

let nextId = 1;

export function createTake({ kind = 'other', name, samples, sampleRate, offset = 0 }) {
  return {
    id: `audio-${nextId++}`,
    role: 'audio',
    kind,
    name: name ?? TAKE_KINDS[kind] ?? 'Take',
    samples,
    sampleRate,
    offset,
    nudge: 0,
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
    notes: [],
  };
}

export function isTake(track) {
  return track.role === 'audio';
}

/** Song time (seconds) where the take's first sample plays. */
export function takeStart(take) {
  return take.offset + take.nudge / 1000;
}

export function takeEnd(take) {
  return takeStart(take) + take.samples.length / take.sampleRate;
}

/** A name like "Drums 2" that isn't already used. */
export function uniqueTakeName(kind, takes) {
  const base = TAKE_KINDS[kind] ?? 'Take';
  const used = new Set(takes.map((t) => t.name));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * Join captured batches ({ frame, samples }, frame = AudioContext frame of the
 * first sample) into one take positioned on the song timeline.
 *
 * The player hears song time s at context frame songStartFrame + s*rate plus
 * the output latency, and the mic delivers what they played after the input
 * latency, so a captured frame f belongs to song frame f - songStartFrame -
 * latencyFrames. Anything before song time 0 (the count-in) is dropped.
 */
export function assembleTake(batches, { songStartFrame, latencyFrames = 0, sampleRate }) {
  if (batches.length === 0) return { samples: new Float32Array(0), offset: 0 };
  const sorted = [...batches].sort((a, b) => a.frame - b.frame);
  const first = sorted[0].frame;
  const last = sorted[sorted.length - 1];
  const all = new Float32Array(last.frame + last.samples.length - first);
  for (const b of sorted) all.set(b.samples, b.frame - first);

  const startSongFrame = first - songStartFrame - latencyFrames;
  const trim = Math.max(0, -startSongFrame);
  return {
    samples: all.subarray(Math.min(trim, all.length)).slice(),
    offset: Math.max(0, startSongFrame) / sampleRate,
  };
}

/** Peak level per bucket, for drawing a waveform. */
export function takePeaks(samples, buckets) {
  const peaks = new Float32Array(buckets);
  if (samples.length === 0) return peaks;
  const per = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const end = Math.min(samples.length, Math.ceil((b + 1) * per));
    for (let i = Math.floor(b * per); i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
    peaks[b] = peak;
  }
  return peaks;
}

/**
 * The take as a WAV file that starts at song time 0 (silence is added in front
 * of a late take), so it lines up when dropped at the start of a DAW project.
 */
export function takeToWav(take) {
  const startFrames = Math.round(takeStart(take) * take.sampleRate);
  let samples = take.samples;
  if (startFrames > 0) {
    samples = new Float32Array(startFrames + take.samples.length);
    samples.set(take.samples, startFrames);
  } else if (startFrames < 0) {
    samples = take.samples.subarray(Math.min(-startFrames, take.samples.length));
  }
  if (take.volume !== 1) samples = samples.map((v) => v * take.volume);
  return encodeWav([samples], take.sampleRate);
}

// ---------- Browser side ----------

const worklets = new WeakMap(); // AudioContext -> Promise

/** Round-trip latency estimate in seconds, as far as the browser reports it. */
export function estimateLatency(ctx, stream) {
  const settings = stream.getAudioTracks()[0]?.getSettings?.() ?? {};
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + (settings.latency || 0);
}

/**
 * Start capturing a mic stream with sample-accurate timing. Returns
 * { source, stop() }, where stop() resolves to the captured batches.
 */
export async function startCapture(ctx, stream) {
  if (!ctx.audioWorklet) throw new Error("this browser can't record in sync (no AudioWorklet)");
  if (!worklets.has(ctx)) {
    const loading = ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    loading.catch(() => worklets.delete(ctx));
    worklets.set(ctx, loading);
  }
  await worklets.get(ctx);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'hummagroove-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
  // The node has to reach the destination to keep being processed; keep it silent.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node).connect(sink).connect(ctx.destination);

  const batches = [];
  let flushed = null;
  node.port.onmessage = (e) => {
    if (e.data.samples) batches.push(e.data);
    if (e.data.flushed) flushed?.();
  };

  return {
    source,
    async stop() {
      await Promise.race([
        new Promise((resolve) => { flushed = resolve; node.port.postMessage('flush'); }),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
      source.disconnect();
      node.disconnect();
      sink.disconnect();
      return batches;
    },
  };
}

/** A short metronome tick. */
export function playClick(ctx, out, time, accent = false) {
  const osc = ctx.createOscillator();
  osc.frequency.value = accent ? 1600 : 1100;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.002);
  amp.gain.setTargetAtTime(0, time + 0.004, 0.015);
  osc.connect(amp).connect(out);
  osc.start(time);
  osc.stop(time + 0.1);
}

/**
 * Click every beat from `startTime`, scheduling a little ahead with a timer so
 * it can run open-ended. `countIn` beats before song time 0 always click;
 * after that it clicks only while `enabled()` is true.
 */
export function startMetronome(ctx, { startTime, bpm, countIn = 0, enabled = () => true }) {
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const beat = 60 / bpm;
  let n = 0;
  const tick = () => {
    while (startTime + n * beat < ctx.currentTime + 0.25) {
      const time = startTime + n * beat;
      if (time >= ctx.currentTime && (n < countIn || enabled())) playClick(ctx, out, time, (n - countIn) % 4 === 0);
      n++;
    }
  };
  tick();
  const timer = setInterval(tick, 50);
  return {
    stop() {
      clearInterval(timer);
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
      setTimeout(() => out.disconnect(), 200);
    },
  };
}

const buffers = new WeakMap(); // take -> AudioBuffer

function takeBuffer(ctx, take) {
  let buffer = buffers.get(take);
  if (!buffer || buffer.sampleRate !== take.sampleRate) {
    buffer = ctx.createBuffer(1, Math.max(1, take.samples.length), take.sampleRate);
    buffer.copyToChannel(take.samples, 0);
    buffers.set(take, buffer);
  }
  return buffer;
}

/**
 * A take as a part for playParts() in src/synth.js, so it shares the mix
 * (level, pan, mute, solo and the master bus) with the instrument tracks.
 */
export function takePart(ctx, take, { gain = take.volume, pan = take.pan ?? 0 } = {}) {
  const sources = [];
  const buffer = takeBuffer(ctx, take);
  return {
    id: take.id,
    gain,
    pan,
    notes: [{ start: takeStart(take), duration: buffer.duration, midi: 0 }],
    play(ctx, out, { start }) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(out);
      // A take nudged earlier than the song start begins part-way through.
      const late = Math.max(0, ctx.currentTime - start);
      if (late >= buffer.duration) return;
      source.start(start + late, late);
      sources.push(source);
    },
    release() {
      for (const source of sources) try { source.stop(); } catch { /* already stopped */ }
    },
  };
}
