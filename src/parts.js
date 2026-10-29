// Generate accompaniment parts for extra instruments from the melody.
// Pure functions: notes in, notes out ({ midi, start, duration, velocity }).
import { harmonize, fitToRange } from './notes.js';

export const PART_TYPES = {
  pad: 'Sustained chords',
  arpeggio: 'Arpeggios',
  stabs: 'Rhythmic stabs',
  harmony: 'Harmony (a third above)',
  double: 'Play the melody',
};

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

/**
 * One chord per bar, chosen to support the melody note that sounds longest
 * in that bar. Returns [{ start, duration, root, pitchClasses }].
 */
export function chordsPerBar(melody, key, bpm) {
  if (!melody.length) return [];
  const bar = (4 * 60) / bpm;
  const end = Math.max(...melody.map((n) => n.start + n.duration));
  const bars = Math.max(1, Math.ceil(end / bar - 1e-6));
  const chords = [];
  let previous = null;
  for (let b = 0; b < bars; b++) {
    const from = b * bar;
    const to = from + bar;
    let best = null;
    let bestOverlap = 0;
    for (const n of melody) {
      const overlap = Math.min(to, n.start + n.duration) - Math.max(from, n.start);
      if (overlap > bestOverlap) {
        best = n;
        bestOverlap = overlap;
      }
    }
    // A silent bar keeps the previous chord ringing.
    const chord = best ? harmonize(best.midi, key) : previous;
    if (!chord) continue;
    chords.push({ start: from, duration: bar, ...chord });
    previous = chord;
  }
  return chords;
}

/** Close-voice a chord around `center`, lowest note first. */
export function voiceChord(pitchClasses, center = 60) {
  return pitchClasses
    .map((pc) => center - 6 + (((pc - (center - 6)) % 12) + 12) % 12)
    .sort((a, b) => a - b);
}

function sameChord(a, b) {
  return a && b && a.root === b.root && a.pitchClasses.join() === b.pitchClasses.join();
}

/** Move a melody note up `steps` scale degrees in the key. */
export function scaleStep(midi, key, steps) {
  const scale = SCALES[key.mode].map((s) => (s + key.tonic) % 12);
  const pc = ((midi % 12) + 12) % 12;
  const degree = scale.indexOf(pc);
  if (degree === -1) return midi + (key.mode === 'major' ? 4 : 3); // chromatic note: a plain third
  const target = scale[(degree + steps) % 7];
  return midi + ((target - pc + 12) % 12);
}

export function generatePart(type, { melody, key, bpm }) {
  const beat = 60 / bpm;
  const chords = chordsPerBar(melody, key, bpm);
  const notes = [];

  if (type === 'pad') {
    // Hold chords across bars while the harmony doesn't change.
    for (let i = 0; i < chords.length; i++) {
      const chord = chords[i];
      let duration = chord.duration;
      while (sameChord(chords[i + 1], chord)) duration += chords[++i].duration;
      for (const midi of voiceChord(chord.pitchClasses, 62)) {
        notes.push({ midi, start: chord.start, duration: duration - 0.02, velocity: 0.7 });
      }
    }
  } else if (type === 'arpeggio') {
    for (const chord of chords) {
      const [a, b, c] = voiceChord(chord.pitchClasses, 66);
      const pattern = [a, b, c, a + 12, c, b, a, b];
      pattern.forEach((midi, i) => {
        notes.push({ midi, start: chord.start + (i * beat) / 2, duration: beat / 2, velocity: i % 2 ? 0.6 : 0.8 });
      });
    }
  } else if (type === 'stabs') {
    for (const chord of chords) {
      const voicing = voiceChord(chord.pitchClasses, 64);
      // Backbeat hits on 2 and 4, plus a push on the "and" of 4.
      for (const [beatPos, length, velocity] of [[1, 0.35, 0.85], [3, 0.35, 0.85], [3.5, 0.3, 0.7]]) {
        for (const midi of voicing) {
          notes.push({ midi, start: chord.start + beatPos * beat, duration: length * beat, velocity });
        }
      }
    }
  } else if (type === 'harmony') {
    for (const n of melody) notes.push({ ...n, midi: fitToRange(scaleStep(n.midi, key, 2), 55, 84), velocity: n.velocity * 0.85 });
  } else if (type === 'double') {
    for (const n of melody) notes.push({ ...n, midi: fitToRange(n.midi, 60, 84) });
  }
  return notes.sort((x, y) => x.start - y.start || x.midi - y.midi);
}
