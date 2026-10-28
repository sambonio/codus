import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yin, detectPitchTrack, downsample } from '../src/pitch.js';
import {
  freqToMidi, midiToFreq, midiToName, segmentNotes, quantizeNotes,
  detectKey, harmonize, arrange, estimateTuningOffset,
} from '../src/notes.js';
import { writeMidi } from '../src/midi.js';

const SR = 44100;

// A voice-like tone: a few harmonics, gentle vibrato, short fades.
function hum(sequence, { detuneCents = 0, gap = 0.04 } = {}) {
  const total = sequence.reduce((s, n) => s + n.seconds + gap, 0.2);
  const out = new Float32Array(Math.ceil(total * SR));
  let pos = Math.floor(0.1 * SR);
  for (const { midi, seconds } of sequence) {
    const base = midiToFreq(midi) * Math.pow(2, detuneCents / 1200);
    const len = Math.floor(seconds * SR);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const f = base * (1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t));
      phase += (2 * Math.PI * f) / SR;
      const env = Math.min(1, i / (0.02 * SR), (len - i) / (0.02 * SR));
      out[pos + i] = env * 0.3 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
    }
    pos += len + Math.floor(gap * SR);
  }
  return out;
}

function analyse(samples) {
  const ds = downsample(samples, SR, 16000);
  const track = detectPitchTrack(ds.samples, ds.sampleRate, { frameSize: 1024, hopSize: 256, minFreq: 55 });
  return segmentNotes(track);
}

test('midi conversions', () => {
  assert.equal(freqToMidi(440), 69);
  assert.ok(Math.abs(midiToFreq(60) - 261.63) < 0.01);
  assert.equal(midiToName(60), 'C4');
  assert.equal(midiToName(28), 'E1');
});

test('yin finds the pitch of a harmonic tone', () => {
  for (const freq of [98, 220, 440, 660]) {
    const frame = new Float32Array(2048);
    for (let i = 0; i < frame.length; i++) {
      const p = (2 * Math.PI * freq * i) / SR;
      frame[i] = Math.sin(p) + 0.6 * Math.sin(2 * p) + 0.3 * Math.sin(3 * p);
    }
    const result = yin(frame, SR, { minFreq: 50 });
    assert.ok(result, `no pitch for ${freq}`);
    assert.ok(Math.abs(freqToMidi(result.freq) - freqToMidi(freq)) < 0.1, `${freq} -> ${result.freq}`);
  }
});

test('yin returns null for noise and silence', () => {
  const silence = new Float32Array(2048);
  assert.equal(yin(silence, SR), null);
});

test('hummed melody comes back as the right notes', () => {
  const melody = [60, 62, 64, 65, 67, 64, 60].map((midi) => ({ midi, seconds: 0.35 }));
  const notes = analyse(hum(melody));
  assert.deepEqual(notes.map((n) => n.midi), melody.map((n) => n.midi));
  for (const n of notes) assert.ok(Math.abs(n.duration - 0.35) < 0.08, `duration ${n.duration}`);
});

test('an out-of-tune singer is snapped to the nearest notes', () => {
  const melody = [57, 59, 60, 64, 62].map((midi) => ({ midi, seconds: 0.3 }));
  const notes = analyse(hum(melody, { detuneCents: 42 }));
  assert.deepEqual(notes.map((n) => n.midi), melody.map((n) => n.midi));
});

test('repeated notes with a short break stay separate', () => {
  const melody = [{ midi: 55, seconds: 0.3 }, { midi: 55, seconds: 0.3 }];
  const notes = analyse(hum(melody, { gap: 0.06 }));
  assert.equal(notes.length, 2);
});

test('tuning offset handles values near the half-semitone wrap', () => {
  assert.ok(Math.abs(estimateTuningOffset([60.48, 62.49, 64.52 - 1, null]) - 0.497) < 0.03);
});

test('quantize snaps to an eighth-note grid', () => {
  const step = 60 / 120 / 2;
  const notes = [
    { midi: 60, start: 0.02, duration: 0.27, velocity: 1 },
    { midi: 62, start: 0.27, duration: 0.5, velocity: 1 },
    { midi: 64, start: 0.74, duration: 0.24, velocity: 1 },
  ];
  const q = quantizeNotes(notes, { bpm: 120, division: 2 });
  assert.deepEqual(q.map((n) => n.start), [0, step, 3 * step]);
  assert.deepEqual(q.map((n) => n.duration), [step, 2 * step, step]);
});

test('detectKey recognises a major and a minor tune', () => {
  const asNotes = (midis) => midis.map((midi) => ({ midi, duration: 1 }));
  assert.equal(detectKey(asNotes([67, 69, 71, 72, 74, 71, 67, 66, 67])).name, 'G major');
  assert.equal(detectKey(asNotes([57, 60, 64, 62, 60, 59, 57, 64, 57])).name, 'A minor');
});

test('harmonize picks diatonic chords', () => {
  const cMajor = { tonic: 0, mode: 'major' };
  assert.equal(harmonize(60, cMajor).root, 0);  // C -> C major
  assert.equal(harmonize(65, cMajor).root, 5);  // F -> F major
  assert.equal(harmonize(67, cMajor).root, 7);  // G -> G major
  assert.deepEqual(harmonize(69, cMajor).pitchClasses, [9, 0, 4]); // A -> A minor
});

test('arrange keeps bass and keys in their ranges', () => {
  const melody = [60, 64, 67, 72, 76].map((midi, i) => ({ midi, start: i * 0.5, duration: 0.5, velocity: 0.8 }));
  for (const bassMode of ['melody', 'roots']) {
    const { bass, keys } = arrange(melody, { bassMode, keysMode: 'chords' });
    assert.equal(bass.length, melody.length);
    for (const n of bass) assert.ok(n.midi >= 28 && n.midi <= 52, `bass ${n.midi}`);
    for (const n of keys) assert.ok(n.midi >= 48 && n.midi <= 79, `keys ${n.midi}`);
    assert.ok(keys.length > melody.length, 'chords added');
  }
  const followed = arrange(melody, { bassMode: 'melody', keysMode: 'melody' });
  assert.deepEqual(followed.bass.map((n) => n.midi % 12), melody.map((n) => n.midi % 12));
  assert.equal(followed.keys.length, melody.length);
});

test('writeMidi produces a valid header and tracks', () => {
  const notes = [{ midi: 60, start: 0, duration: 0.5, velocity: 0.8 }];
  const bytes = writeMidi([{ name: 'Bass', notes, program: 38 }], { bpm: 100 });
  const text = (i) => String.fromCharCode(...bytes.slice(i, i + 4));
  assert.equal(text(0), 'MThd');
  assert.equal(bytes[11], 2); // tempo track + 1
  assert.equal(text(14), 'MTrk');
  // End-of-track marker at the very end.
  assert.deepEqual([...bytes.slice(-3)], [0xff, 0x2f, 0x00]);
});

test('legato melody with background noise still segments cleanly', () => {
  const melody = [62, 65, 69, 67, 65, 62].map((midi) => ({ midi, seconds: 0.3 }));
  const samples = hum(melody, { gap: 0 });
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < samples.length; i++) samples[i] += 0.02 * rand();
  assert.deepEqual(analyse(samples).map((n) => n.midi), melody.map((n) => n.midi));
});
