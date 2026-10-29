import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barLength, sectionBars, buildTimeline, createSection, moveInOrder, removeSection } from '../src/arrangement.js';
import { generatePart } from '../src/parts.js';

const note = (midi, start, duration = 0.5) => ({ midi, start, duration, velocity: 0.8 });
// At 120 BPM a bar is 2 s.
const verse = { id: 'v', name: 'Verse', melody: [note(60, 0), note(64, 0.5), note(67, 1), note(65, 2.5, 1)] }; // 2 bars
const chorus = { id: 'c', name: 'Chorus', melody: [note(72, 0, 1), note(71, 1)] }; // 1 bar

test('sections are rounded up to whole bars', () => {
  assert.equal(barLength(120), 2);
  assert.equal(sectionBars(verse, 120), 2);
  assert.equal(sectionBars(chorus, 120), 1);
  assert.equal(sectionBars({ melody: [] }, 120), 1);
});

test('the timeline plays sections in order, each from a bar line', () => {
  const t = buildTimeline([verse, chorus], ['v', 'c', 'v', 'c'], { bpm: 120 });
  assert.deepEqual(t.markers.map((m) => [m.name, m.start, m.end]), [
    ['Verse', 0, 4], ['Chorus', 4, 6], ['Verse', 6, 10], ['Chorus', 10, 12],
  ]);
  assert.equal(t.melody.length, 2 * (verse.melody.length + chorus.melody.length));
  assert.deepEqual(t.melody.filter((n) => n.midi === 72).map((n) => n.start), [4, 10]);
  // Bass and keys are shifted along with the melody.
  assert.deepEqual(t.parts.bass.filter((n) => n.start >= 6 && n.start < 10).length, verse.melody.length);
  assert.ok(t.parts.keys.every((n) => n.start < 12));
});

test('one key is used for the whole song', () => {
  const t = buildTimeline([verse, chorus], ['v', 'c'], { bpm: 120 });
  assert.equal(t.key.name, 'C major');
  const fixed = buildTimeline([verse], ['v'], { bpm: 120, key: { tonic: 7, mode: 'major', name: 'G major' } });
  assert.equal(fixed.key.name, 'G major');
});

test('unknown section ids are skipped', () => {
  const t = buildTimeline([verse], ['x', 'v'], { bpm: 120 });
  assert.equal(t.markers.length, 1);
  assert.equal(t.markers[0].start, 0);
});

test('extra parts generated over the timeline line up with the sections', () => {
  const t = buildTimeline([verse, chorus], ['c', 'v'], { bpm: 120 });
  const pad = generatePart('pad', { melody: t.melody, key: t.key, bpm: 120 });
  assert.ok(pad.some((n) => n.start === 0));
  assert.ok(Math.max(...pad.map((n) => n.start + n.duration)) <= 6);
});

test('new sections get the next free name', () => {
  const a = createSection([], []);
  const b = createSection([a], []);
  assert.equal(a.name, 'Verse');
  assert.equal(b.name, 'Chorus');
  assert.notEqual(a.id, b.id);
  assert.equal(createSection([a], [], 'Hook').name, 'Hook');
});

test('the order can be rearranged and sections removed', () => {
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(removeSection([verse, chorus], ['v', 'c', 'v'], 'v'), { sections: [chorus], order: ['c'] });
});
