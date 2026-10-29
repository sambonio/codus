// The song model: the hummed melody plus the instrument tracks built from it.
//
//   song  = { bpm, key, origin, melody, tracks }
//   track = { id, name, role, instrument, notes, volume, muted }
//
// `origin` is where the melody starts in the original recording (seconds),
// and every note time is relative to it. `instrument` is an id from
// src/instruments/index.js. Track settings the user changes (instrument,
// volume, mute) survive re-arranging, keyed by track id.

export const DEFAULT_TRACKS = [
  { id: 'bass', name: 'Bass', role: 'bass', instrument: 'electric-bass', volume: 0.9, muted: false },
  { id: 'keys', name: 'Keys', role: 'keys', instrument: 'organ-gospel', volume: 0.8, muted: false },
];

export function buildSong({ melody, key, bpm, origin, parts }, settings = {}) {
  const tracks = DEFAULT_TRACKS.map((defaults) => ({
    ...defaults,
    ...settings[defaults.id],
    notes: parts[defaults.id] ?? [],
  }));
  return { bpm, key, origin, melody, tracks };
}

/** The user-editable part of each track, to carry across rebuilds. */
export function trackSettings(song) {
  const settings = {};
  for (const t of song?.tracks ?? []) {
    settings[t.id] = { instrument: t.instrument, volume: t.volume, muted: t.muted };
  }
  return settings;
}

export function songLength(song) {
  const notes = [...song.melody, ...song.tracks.flatMap((t) => t.notes)];
  return notes.length ? Math.max(...notes.map((n) => n.start + n.duration)) : 0;
}
