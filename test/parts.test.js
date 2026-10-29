import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordsPerBar, voiceChord, scaleStep, generatePart, PART_TYPES } from '../src/parts.js';
import { buildFromDescription, SUGGESTIONS } from '../src/builder.js';
import { getInstrument } from '../src/instruments/index.js';

const C = { tonic: 0, mode: 'major' };
const bpm = 120; // one bar = 2 s
const melody = [
  { midi: 72, start: 0, duration: 1.5, velocity: 0.9 },   // C: bar 1 -> C major
  { midi: 74, start: 1.5, duration: 0.5, velocity: 0.7 },
  { midi: 77, start: 2, duration: 1.8, velocity: 0.8 },   // F: bar 2 -> F major
  { midi: 79, start: 4, duration: 2, velocity: 1 },       // G: bar 3 -> G major
];

test('chordsPerBar harmonises the longest note in each bar', () => {
  const chords = chordsPerBar(melody, C, bpm);
  assert.deepEqual(chords.map((c) => c.root), [0, 5, 7]);
  assert.deepEqual(chords.map((c) => c.start), [0, 2, 4]);
});

test('voiceChord keeps chords close around the centre', () => {
  const v = voiceChord([7, 11, 2], 60);
  assert.deepEqual(v, [55, 59, 62]);
  assert.ok(Math.max(...v) - Math.min(...v) < 12);
});

test('scaleStep moves by scale degrees', () => {
  assert.equal(scaleStep(60, C, 2), 64); // C -> E
  assert.equal(scaleStep(62, C, 2), 65); // D -> F (minor third)
  assert.equal(scaleStep(71, C, 2), 74); // B -> D
  assert.equal(scaleStep(61, C, 2), 65); // chromatic: plain major third
});

test('every part type produces in-key notes inside the song', () => {
  for (const type of Object.keys(PART_TYPES)) {
    const notes = generatePart(type, { melody, key: C, bpm });
    assert.ok(notes.length > 0, type);
    for (const n of notes) {
      assert.ok(n.start >= 0 && n.start < 6 && n.duration > 0, `${type} timing`);
      assert.ok([0, 2, 4, 5, 7, 9, 11].includes(n.midi % 12), `${type} note ${n.midi} out of key`);
      assert.ok(n.midi >= 40 && n.midi <= 90, `${type} range`);
    }
  }
});

test('pads hold a chord while the harmony stays the same', () => {
  const held = [{ midi: 72, start: 0, duration: 4, velocity: 1 }];
  const notes = generatePart('pad', { melody: held, key: C, bpm });
  assert.equal(notes.length, 3);
  assert.ok(notes.every((n) => n.duration > 3.9));
});

test('the builder understands its own suggestions', () => {
  for (const s of SUGGESTIONS) {
    const built = buildFromDescription(s);
    assert.ok(built, s);
    assert.ok(getInstrument(built.instrument), `${s} -> ${built.instrument}`);
    assert.ok(PART_TYPES[built.part]);
  }
  assert.equal(buildFromDescription('funky clavinet').part, 'stabs');
  assert.equal(buildFromDescription('cello melody').instrument, 'gm-cello');
  assert.equal(buildFromDescription('cello melody').part, 'double');
  assert.equal(buildFromDescription('upright bass').instrument, 'upright-bass');
  assert.equal(buildFromDescription(''), null);
  assert.equal(buildFromDescription('asdfgh'), null);
});
