import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawbarGain, organSpectrum, ORGAN_PRESETS, DRAWBAR_HARMONICS } from '../src/instruments/organ.js';

test('drawbars step about 3 dB each, with 0 meaning off', () => {
  assert.equal(drawbarGain(0), 0);
  assert.equal(drawbarGain(8), 1);
  assert.ok(Math.abs(20 * Math.log10(drawbarGain(7)) + 3) < 1e-9);
  assert.ok(Math.abs(20 * Math.log10(drawbarGain(1)) + 21) < 1e-9);
});

test('drawbars map to the Hammond footages', () => {
  // 888000000: 16', 5 1/3', 8' -> half, 1.5x and 1x the note frequency.
  const amps = organSpectrum(261.63, [8, 8, 8, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...amps.keys()].filter((h) => amps[h] > 0), [1, 2, 3]);
  assert.equal(DRAWBAR_HARMONICS.length, 9);
});

test('high drawbars fold back an octave above the top tonewheel', () => {
  const low = organSpectrum(261.63, [0, 0, 0, 0, 0, 0, 0, 0, 8]); // 1' on middle C: 2093 Hz
  assert.equal(low[16], 1);
  const high = organSpectrum(880, [0, 0, 0, 0, 0, 0, 0, 0, 8]); // 1' on A5 would be 7040 Hz
  assert.equal(high[16], 0);
  assert.equal(high[8], 1);
});

test('every preset is a valid registration', () => {
  for (const [id, preset] of Object.entries(ORGAN_PRESETS)) {
    assert.equal(preset.drawbars.length, 9, id);
    assert.ok(preset.drawbars.every((d) => Number.isInteger(d) && d >= 0 && d <= 8), id);
    assert.ok(preset.drive >= 0 && preset.drive <= 1, id);
  }
});
