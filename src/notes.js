// Turn a pitch track into notes, and arrange those notes into bass and keys parts.
// Pure functions, no browser APIs.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * People rarely hum in tune with A440. Find the median offset (in semitones,
 * between -0.5 and 0.5) of voiced frames from the equal-tempered grid.
 */
export function estimateTuningOffset(midiValues) {
  const voiced = midiValues.filter((m) => m !== null);
  if (voiced.length === 0) return 0;
  // Circular mean of the fractional part, so values near ±0.5 don't cancel out.
  let x = 0, y = 0;
  for (const m of voiced) {
    const angle = 2 * Math.PI * (m - Math.round(m));
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  return Math.atan2(y, x) / (2 * Math.PI);
}

/**
 * Convert a pitch track into discrete notes.
 * notes: [{ midi, start, duration, velocity }] with times in seconds.
 */
export function segmentNotes(track, {
  minNoteSeconds = 0.08,
  maxGapSeconds = 0.03,
  smoothingFrames = 5,
  correctTuning = true,
} = {}) {
  const { frames, hopSeconds } = track;
  const raw = frames.map((f) => (f.freq ? freqToMidi(f.freq) : null));

  // Median filter over voiced neighbours to kill octave blips and jitter.
  const half = smoothingFrames >> 1;
  const smoothed = raw.map((m, i) => {
    if (m === null) return null;
    const neighbours = [];
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < raw.length && raw[j] !== null) neighbours.push(raw[j]);
    }
    return median(neighbours);
  });

  const offset = correctTuning ? estimateTuningOffset(smoothed) : 0;
  const quantized = smoothed.map((m) => (m === null ? null : Math.round(m - offset)));

  // Group consecutive frames with the same pitch.
  const runs = [];
  for (let i = 0; i < quantized.length; i++) {
    const midi = quantized[i];
    const last = runs[runs.length - 1];
    if (last && last.midi === midi && last.end === i) {
      last.end = i + 1;
      last.rmsSum += frames[i].rms;
    } else {
      runs.push({ midi, startIdx: i, end: i + 1, rmsSum: frames[i].rms });
    }
  }

  // Absorb very short pitched runs into a neighbour (glides between notes),
  // and bridge tiny unvoiced gaps between identical pitches.
  const minFrames = Math.max(1, Math.round(minNoteSeconds / hopSeconds));
  const maxGapFrames = Math.max(0, Math.round(maxGapSeconds / hopSeconds));
  const notes = [];
  for (const run of runs) {
    if (run.midi === null) continue;
    const prev = notes[notes.length - 1];
    const gap = prev ? run.startIdx - prev.end : Infinity;
    if (prev && prev.midi === run.midi && gap <= maxGapFrames) {
      prev.end = run.end;
      prev.rmsSum += run.rmsSum;
      continue;
    }
    if (run.end - run.startIdx < minFrames) {
      if (prev && gap === 0) prev.end = run.end;
      continue;
    }
    notes.push({ ...run });
  }

  const startTime = frames.length ? frames[0].time - hopSeconds / 2 : 0;
  const peak = Math.max(1e-9, ...notes.map((n) => n.rmsSum / (n.end - n.startIdx)));
  return notes.map((n) => ({
    midi: n.midi,
    start: startTime + n.startIdx * hopSeconds,
    duration: (n.end - n.startIdx) * hopSeconds,
    velocity: Math.min(1, 0.4 + 0.6 * (n.rmsSum / (n.end - n.startIdx)) / peak),
  }));
}

/**
 * Snap notes to a tempo grid. `division` is steps per beat (2 = eighth notes).
 * The first note lands on beat one. Overlaps are trimmed; nothing is dropped
 * unless two notes snap onto the same step, where the longer one wins.
 */
export function quantizeNotes(notes, { bpm = 100, division = 2 } = {}) {
  if (notes.length === 0) return [];
  const step = 60 / bpm / division;
  const origin = notes[0].start;
  const byStep = new Map();
  for (const n of notes) {
    const startStep = Math.round((n.start - origin) / step);
    const lengthSteps = Math.max(1, Math.round(n.duration / step));
    const existing = byStep.get(startStep);
    if (!existing || existing.lengthSteps < lengthSteps) {
      byStep.set(startStep, { ...n, startStep, lengthSteps });
    }
  }
  const sorted = [...byStep.values()].sort((a, b) => a.startStep - b.startStep);
  return sorted.map((n, i) => {
    const next = sorted[i + 1];
    const lengthSteps = next ? Math.min(n.lengthSteps, next.startStep - n.startStep) : n.lengthSteps;
    return { midi: n.midi, velocity: n.velocity, start: n.startStep * step, duration: lengthSteps * step };
  });
}

// Krumhansl-Kessler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a, b) {
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - meanA) * (b[i] - meanB);
    da += (a[i] - meanA) ** 2;
    db += (b[i] - meanB) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Guess the key from duration-weighted pitch classes. Returns { tonic, mode, name }. */
export function detectKey(notes) {
  const histogram = new Array(12).fill(0);
  for (const n of notes) histogram[((n.midi % 12) + 12) % 12] += n.duration;
  let best = { tonic: 0, mode: 'major', score: -Infinity };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]]) {
      const rotated = profile.map((_, i) => profile[(i - tonic + 12) % 12]);
      const score = correlation(histogram, rotated);
      if (score > best.score) best = { tonic, mode, score };
    }
  }
  return { tonic: best.tonic, mode: best.mode, name: `${NOTE_NAMES[best.tonic]} ${best.mode}` };
}

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

/** Move a pitch by whole octaves into [low, high]. */
export function fitToRange(midi, low, high) {
  let m = midi;
  while (m < low) m += 12;
  while (m > high) m -= 12;
  return m;
}

/**
 * Pick the diatonic triad that best supports a melody note. Prefers chords
 * where the note is the root, then the third, then the fifth, among the
 * strong diatonic chords (I, IV, V, vi / i, iv, v, VI, VII).
 * Returns the chord's root pitch class and its three pitch classes.
 */
export function harmonize(midi, key) {
  const scale = SCALES[key.mode].map((s) => (s + key.tonic) % 12);
  const triads = scale.map((_, degree) => [0, 2, 4].map((step) => scale[(degree + step) % 7]));
  const preferredDegrees = key.mode === 'major' ? [0, 3, 4, 5, 1] : [0, 3, 4, 5, 6, 2];
  const pc = ((midi % 12) + 12) % 12;
  for (const position of [0, 1, 2]) {
    for (const degree of preferredDegrees) {
      if (triads[degree][position] === pc) return { root: triads[degree][0], pitchClasses: triads[degree] };
    }
  }
  // Chromatic note: fall back to the tonic chord.
  return { root: triads[0][0], pitchClasses: triads[0] };
}

/**
 * Build bass and keys parts from melody notes.
 *
 * bassMode:
 *   'melody' - the bass doubles the hummed melody, dropped into bass range.
 *   'roots'  - the bass plays the root of the chord under each melody note.
 * keysMode:
 *   'melody' - keys play the melody.
 *   'chords' - keys play the melody on top of a harmonising triad.
 */
export function arrange(notes, { bassMode = 'melody', keysMode = 'chords', key = detectKey(notes) } = {}) {
  const bass = notes.map((n) => {
    const source = bassMode === 'roots' ? harmonize(n.midi, key).root : n.midi;
    return { ...n, midi: fitToRange(source, 28, 52) };
  });

  const keys = [];
  for (const n of notes) {
    const melody = fitToRange(n.midi, 60, 79);
    keys.push({ ...n, midi: melody });
    if (keysMode === 'chords') {
      const { pitchClasses } = harmonize(n.midi, key);
      // Voice the triad just below the melody note.
      for (const pc of pitchClasses) {
        let voice = melody - 1 - ((melody - 1 - pc) % 12 + 12) % 12;
        if (voice < 48) voice += 12;
        if (voice !== melody && voice < melody) keys.push({ ...n, midi: voice, velocity: n.velocity * 0.6 });
      }
    }
  }
  return { key, bass, keys };
}
