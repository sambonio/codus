// Builds samples/<instrument>/ (MP3s + manifest.json) from the original
// Karoryfer SFZ libraries. Needs ffmpeg on PATH.
//
//   node tools/prepare-bass-samples.mjs <path to Swagbass> <path to Meatbass>
//
// Swagbass:  https://github.com/sfzinstruments/karoryfer.swagbass (CC0)
// Meatbass:  https://github.com/sfzinstruments/karoryfer.meatbass (CC BY 4.0)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { yin } from '../src/pitch.js';
import { freqToMidi } from '../src/notes.js';

const [swagDir, meatDir] = process.argv.slice(2);
if (!swagDir || !meatDir) {
  console.error('usage: node tools/prepare-bass-samples.mjs <Swagbass dir> <Meatbass dir>');
  process.exit(1);
}

const OUT = new URL('../samples/', import.meta.url).pathname;
const KEYS = [30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60]; // every minor third, F#1 to C4
const PITCH_NAMES = { 0: 'c', 3: 'eb', 6: 'gb', 9: 'a' };
const ROUND_ROBINS = [1, 2];
const MAX_SECONDS = 4.5;
const FADE_SECONDS = 0.4;

const INSTRUMENTS = [
  {
    id: 'electric-bass',
    name: 'Electric bass',
    credit: 'Swagbass by Karoryfer Lecolds (D. Smolken): Ibanez BTB-400QM, flatwound strings, neck pickup, recorded direct.',
    license: 'CC0 1.0',
    source: 'https://github.com/sfzinstruments/karoryfer.swagbass',
    release: 0.05,
    // Karoryfer named these files an octave higher than MIDI convention (a2 = MIDI 33).
    file: (key, layer, rr) => join(swagDir, 'notes', `${PITCH_NAMES[key % 12]}${Math.floor(key / 12)}_${layer}_rr${rr}.wav`),
    layers: [{ name: 'p', lovel: 0, hivel: 50 }, { name: 'f', lovel: 51, hivel: 110 }, { name: 'fff', lovel: 111, hivel: 127 }],
  },
  {
    id: 'upright-bass',
    name: 'Upright bass',
    credit: 'Meatbass by Karoryfer Lecolds: 1958 Otto Rubner double bass played pizzicato by Drogomir Smolken, recorded by Ludwik Zamenhof.',
    license: 'CC BY 4.0',
    source: 'https://github.com/sfzinstruments/karoryfer.meatbass',
    release: 0.09,
    file: (key, layer, rr) => join(meatDir, 'Samples', 'pizz', `${PITCH_NAMES[key % 12]}${Math.floor(key / 12) - 1}_${layer}_rr${rr}.wav`),
    layers: [{ name: 'vl1', lovel: 0, hivel: 32 }, { name: 'vl2', lovel: 33, hivel: 64 }, { name: 'vl3', lovel: 65, hivel: 96 }, { name: 'vl4', lovel: 97, hivel: 127 }],
  },
];

function maxVolume(file) {
  // volumedetect reports on stderr.
  const { stderr } = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  return parseFloat(stderr.split('max_volume:')[1]);
}

// Real strings are rarely spot on. Measure each sample after the attack and
// return the correction in cents (0 if the pitch can't be read confidently).
function tuningCents(file, key) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '44100', '-']);
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const offsets = [];
  for (const t of [0.4, 0.7, 1.0]) {
    const start = Math.floor(t * 44100);
    if (start + 8192 > samples.length) continue;
    const result = yin(samples.subarray(start, start + 8192), 44100, { minFreq: 25, threshold: 0.15 });
    if (result) offsets.push((freqToMidi(result.freq) - key) * 100);
  }
  offsets.sort((a, b) => a - b);
  const median = offsets[offsets.length >> 1];
  return offsets.length && Math.abs(median) < 40 ? -Math.round(median) : 0;
}

for (const inst of INSTRUMENTS) {
  const dir = join(OUT, inst.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const jobs = [];
  for (const key of KEYS) {
    for (const layer of inst.layers) {
      for (const rr of ROUND_ROBINS) jobs.push({ key, layer, rr, src: inst.file(key, layer.name, rr) });
    }
  }
  // One gain for the whole instrument keeps the velocity layers' natural balance.
  const loudest = Math.max(...jobs.map((j) => maxVolume(j.src)));
  const gainDb = -1 - loudest;

  const zones = [];
  for (const key of KEYS) {
    for (const layer of inst.layers) {
      const files = [];
      const tunes = [];
      for (const rr of ROUND_ROBINS) {
        const job = jobs.find((j) => j.key === key && j.layer === layer && j.rr === rr);
        const name = `${key}-${layer.name}-${rr}.mp3`;
        execFileSync('ffmpeg', [
          '-v', 'error', '-y', '-i', job.src,
          '-af', [
            'aformat=channel_layouts=mono',
            'silenceremove=start_periods=1:start_threshold=-60dB',
            `volume=${gainDb.toFixed(2)}dB`,
            `atrim=0:${MAX_SECONDS}`,
            `afade=t=out:st=${MAX_SECONDS - FADE_SECONDS}:d=${FADE_SECONDS}`,
          ].join(','),
          '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '2', join(dir, name),
        ]);
        files.push(name);
        tunes.push(tuningCents(join(dir, name), key));
      }
      const tune = Math.round(tunes.reduce((a, b) => a + b, 0) / tunes.length);
      zones.push({ key, lovel: layer.lovel, hivel: layer.hivel, tune, files });
    }
  }

  const manifest = {
    name: inst.name, credit: inst.credit, license: inst.license, source: inst.source,
    release: inst.release, zones,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`${inst.id}: ${zones.length} zones, ${jobs.length} files, gain ${gainDb.toFixed(1)} dB`);
}
