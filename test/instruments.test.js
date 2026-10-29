import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pickZone, toMidiVelocity } from '../src/instruments/multisampler.js';
import { buildSong, songLength, addExtraTrack, setTrackPart } from '../src/song.js';

const zones = [
  { key: 30, lovel: 0, hivel: 64 }, { key: 30, lovel: 65, hivel: 127 },
  { key: 33, lovel: 0, hivel: 64 }, { key: 33, lovel: 65, hivel: 127 },
  { key: 36, lovel: 0, hivel: 64 }, { key: 36, lovel: 65, hivel: 127 },
];

test('pickZone chooses the nearest sample in the right velocity layer', () => {
  assert.deepEqual(pickZone(zones, 33, 100), zones[3]);
  assert.deepEqual(pickZone(zones, 34, 20), zones[2]);
  assert.deepEqual(pickZone(zones, 40, 127), zones[5]); // above the range: pitch up the top sample
  // Halfway between two samples, pitch the higher one down.
  assert.deepEqual(pickZone([{ key: 30, lovel: 0, hivel: 127 }, { key: 32, lovel: 0, hivel: 127 }], 31, 80).key, 32);
});

test('toMidiVelocity keeps quiet hums audible and loud ones at full force', () => {
  assert.equal(toMidiVelocity(1), 127);
  assert.ok(toMidiVelocity(0.4) > 60 && toMidiVelocity(0.4) < 90);
  assert.ok(toMidiVelocity(0) >= 1);
});

for (const id of ['electric-bass', 'upright-bass']) {
  test(`${id} manifest covers the bass range with velocity layers and round robins`, () => {
    const dir = new URL(`../samples/${id}/`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
    assert.ok(manifest.license && manifest.credit);
    for (let midi = 33; midi <= 57; midi++) {
      for (const velocity of [1, 40, 80, 127]) {
        const zone = pickZone(manifest.zones, midi, velocity);
        assert.ok(zone, `no zone for ${midi}@${velocity}`);
        assert.ok(Math.abs(zone.key - midi) <= 2, `${midi} would be pitched too far`);
      }
    }
    const layers = new Set(manifest.zones.map((z) => z.lovel));
    assert.ok(layers.size >= 3, 'several velocity layers');
    for (const zone of manifest.zones) {
      assert.ok(zone.files.length >= 2, 'round robins');
      assert.ok(Math.abs(zone.tune) < 40);
      for (const f of zone.files) assert.ok(existsSync(new URL(f, dir)), `${f} missing`);
    }
  });
}

test('buildSong keeps the user\'s track settings across rebuilds', () => {
  const melody = [{ midi: 60, start: 0, duration: 1, velocity: 1 }];
  const parts = { bass: [{ midi: 36, start: 0, duration: 1, velocity: 1 }], keys: [] };
  const first = buildSong({ melody, key: { tonic: 0, mode: 'major' }, bpm: 100, origin: 0.5, parts });
  assert.deepEqual(first.tracks.map((t) => t.id), ['bass', 'keys']);
  first.tracks[0].instrument = 'upright-bass';
  first.tracks[1].muted = true;
  const second = buildSong({ melody, key: first.key, bpm: 120, origin: 0.5, parts }, first.tracks);
  assert.equal(second.tracks[0].instrument, 'upright-bass');
  assert.equal(second.tracks[1].muted, true);
  assert.equal(second.tracks[0].notes, parts.bass);
  assert.equal(songLength(second), 1);
});

test('extra tracks are regenerated from the new melody on rebuild', () => {
  const key = { tonic: 0, mode: 'major' };
  const parts = { bass: [], keys: [] };
  const song = buildSong({ melody: [{ midi: 60, start: 0, duration: 2.4, velocity: 1 }], key, bpm: 100, origin: 0, parts });
  const extra = addExtraTrack(song, { name: 'Strings', instrument: 'gm-string_ensemble_1', part: 'pad' });
  assert.deepEqual(extra.notes.map((n) => n.midi % 12).sort(), [0, 4, 7]);
  setTrackPart(song, extra, 'double');
  assert.equal(extra.notes.length, 1);
  extra.volume = 0.3;

  const melody = [{ midi: 67, start: 0, duration: 1, velocity: 1 }, { midi: 69, start: 1, duration: 1, velocity: 1 }];
  const rebuilt = buildSong({ melody, key, bpm: 100, origin: 0, parts }, song.tracks);
  const again = rebuilt.tracks.find((t) => t.id === extra.id);
  assert.equal(again.volume, 0.3);
  assert.equal(again.part, 'double');
  assert.deepEqual(again.notes.map((n) => n.midi % 12), [7, 9]);
});

test('tracks with roles the arranger does not know are kept as they are', () => {
  const audio = { id: 'take-1', name: 'Drums', role: 'audio', volume: 1, muted: false };
  const song = buildSong({ melody: [], key: { tonic: 0, mode: 'major' }, bpm: 100, origin: 0, parts: {} }, [audio]);
  assert.equal(song.tracks.at(-1), audio);
});
