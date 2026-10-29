import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pickZone, toMidiVelocity } from '../src/instruments/multisampler.js';
import { buildSong, trackSettings, songLength } from '../src/song.js';

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
  const second = buildSong({ melody, key: first.key, bpm: 120, origin: 0.5, parts }, trackSettings(first));
  assert.equal(second.tracks[0].instrument, 'upright-bass');
  assert.equal(second.tracks[1].muted, true);
  assert.equal(second.tracks[0].notes, parts.bass);
  assert.equal(songLength(second), 1);
});
