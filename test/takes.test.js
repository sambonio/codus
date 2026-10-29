import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTake, takeStart, takeEnd, uniqueTakeName, assembleTake, takePeaks, takeToWav,
} from '../src/takes.js';
import { encodeWav } from '../src/wav.js';

const SR = 48000;

function batchesOf(samples, firstFrame, size = 4096) {
  const out = [];
  for (let i = 0; i < samples.length; i += size) out.push({ frame: firstFrame + i, samples: samples.slice(i, i + size) });
  return out;
}

test('assembleTake drops the count-in and compensates for latency', () => {
  // Capture starts 1 s before the song; there's a hit at song time 0.5 s
  // which arrives 20 ms late because of round-trip latency.
  const songStartFrame = 10 * SR;
  const latencyFrames = 0.02 * SR;
  const captured = new Float32Array(3 * SR);
  const hitAt = 1 * SR + 0.5 * SR + latencyFrames;
  captured[hitAt] = 1;
  const batches = batchesOf(captured, songStartFrame - SR).reverse(); // order shouldn't matter
  const { samples, offset } = assembleTake(batches, { songStartFrame, latencyFrames, sampleRate: SR });
  assert.equal(offset, 0);
  assert.equal(samples.indexOf(1), 0.5 * SR);
});

test('assembleTake positions a take that starts mid-song', () => {
  const songStartFrame = 1000;
  const captured = new Float32Array(SR).fill(0.1);
  const { samples, offset } = assembleTake(batchesOf(captured, songStartFrame + 2 * SR), { songStartFrame, sampleRate: SR });
  assert.equal(offset, 2);
  assert.equal(samples.length, SR);
});

test('assembleTake leaves gaps from dropped batches silent', () => {
  const a = { frame: 0, samples: new Float32Array(10).fill(1) };
  const b = { frame: 20, samples: new Float32Array(10).fill(1) };
  const { samples } = assembleTake([a, b], { songStartFrame: 0, sampleRate: SR });
  assert.equal(samples.length, 30);
  assert.equal(samples[15], 0);
  assert.equal(samples[25], 1);
});

test('take timing includes the nudge', () => {
  const take = createTake({ kind: 'drums', samples: new Float32Array(SR), sampleRate: SR, offset: 1 });
  take.nudge = -250;
  assert.equal(takeStart(take), 0.75);
  assert.equal(takeEnd(take), 1.75);
});

test('uniqueTakeName counts up per kind', () => {
  const takes = [{ name: 'Drums' }, { name: 'Drums 2' }, { name: 'Guitar' }];
  assert.equal(uniqueTakeName('drums', takes), 'Drums 3');
  assert.equal(uniqueTakeName('vocals', takes), 'Vocals');
});

test('takePeaks finds the loudest sample per bucket', () => {
  const samples = new Float32Array([0, 0.5, 0, -0.8, 0.1, 0.2]);
  assert.deepEqual([...takePeaks(samples, 3)].map((v) => +v.toFixed(2)), [0.5, 0.8, 0.2]);
});

test('encodeWav writes a valid 16-bit PCM header and data', () => {
  const bytes = encodeWav([new Float32Array([0, 1, -1, 0.5])], 44100);
  const view = new DataView(bytes.buffer);
  const ascii = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 4), 'WAVE');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)), [0, 32767, -32768, 16383]);
});

test('takeToWav pads a late take so it lines up with the song start', () => {
  const take = createTake({ samples: new Float32Array(100).fill(0.5), sampleRate: 1000, offset: 0.05 });
  const bytes = takeToWav(take);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(40, true), 150 * 2);
  assert.equal(view.getInt16(44 + 49 * 2, true), 0);
  assert.ok(view.getInt16(44 + 50 * 2, true) > 16000);
});
