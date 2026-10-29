import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSong, audibleGain, songLength } from '../src/song.js';

const key = { tonic: 0, mode: 'major', name: 'C major' };
const melody = [{ midi: 60, start: 0, duration: 0.5, velocity: 0.8 }];
const input = { melody, key, bpm: 120, origin: 0, parts: { bass: melody, keys: melody } };

test('solo silences every other track, mute always wins', () => {
  const { tracks } = buildSong(input);
  const [bass, keys] = tracks;
  assert.equal(audibleGain(bass, tracks), bass.volume);
  keys.solo = true;
  assert.equal(audibleGain(bass, tracks), 0);
  assert.equal(audibleGain(keys, tracks), keys.volume);
  keys.muted = true;
  assert.equal(audibleGain(keys, tracks), 0);
});

test('pan and solo survive re-arranging', () => {
  const first = buildSong(input);
  first.tracks[0].pan = -0.4;
  first.tracks[1].solo = true;
  const again = buildSong(input, first.tracks);
  assert.equal(again.tracks[0].pan, -0.4);
  assert.equal(again.tracks[1].solo, true);
});

test('the song runs to the end of its last section', () => {
  const markers = [{ sectionId: 'a', name: 'Verse', start: 0, end: 2 }, { sectionId: 'b', name: 'Chorus', start: 2, end: 4 }];
  assert.equal(songLength(buildSong({ ...input, markers })), 4);
  assert.equal(songLength(buildSong(input)), 0.5);
});
