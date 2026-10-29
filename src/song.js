// The song model: the hummed melody plus the instrument tracks built from it.
//
//   song  = { bpm, key, origin, melody, tracks }
//   track = { id, name, role, instrument, notes, volume, muted, part? }
//
// `origin` is where the melody starts in the original recording (seconds),
// and every note time is relative to it. `instrument` is an id from
// src/instruments/index.js. Roles: 'bass' and 'keys' are the two lines
// arranged from the melody; 'extra' tracks are added with the instrument
// builder and play a generated `part` (see src/parts.js). Track settings the
// user changes survive re-arranging, and extra tracks are regenerated from
// the new melody. Tracks with any other role are carried over untouched.
import { generatePart } from './parts.js';

export const DEFAULT_TRACKS = [
  { id: 'bass', name: 'Bass', role: 'bass', instrument: 'electric-bass', volume: 0.9, muted: false },
  { id: 'keys', name: 'Keys', role: 'keys', instrument: 'organ-gospel', volume: 0.8, muted: false },
];

/**
 * Build a song from an arranged melody. `previous` is the old track list,
 * whose user settings and extra tracks carry over.
 */
export function buildSong({ melody, key, bpm, origin, parts }, previous = []) {
  const byId = new Map(previous.map((t) => [t.id, t]));
  const tracks = DEFAULT_TRACKS.map((defaults) => {
    const old = byId.get(defaults.id);
    const settings = old ? { instrument: old.instrument, volume: old.volume, muted: old.muted } : {};
    return { ...defaults, ...settings, notes: parts[defaults.id] ?? [] };
  });
  const song = { bpm, key, origin, melody, tracks };
  for (const old of previous) {
    if (old.role === 'extra') tracks.push({ ...old, notes: generatePart(old.part, song) });
    else if (!DEFAULT_TRACKS.some((d) => d.id === old.id)) tracks.push(old);
  }
  return song;
}

let nextExtraId = 1;

/** Add an instrument-builder track to a song, generating its part. */
export function addExtraTrack(song, { name, instrument, part }) {
  const track = {
    id: `extra-${nextExtraId++}`, name, role: 'extra', instrument, part,
    volume: 0.7, muted: false, notes: generatePart(part, song),
  };
  song.tracks.push(track);
  return track;
}

/** Change what an extra track plays. */
export function setTrackPart(song, track, part) {
  track.part = part;
  track.notes = generatePart(part, song);
}

export function songLength(song) {
  const notes = [...song.melody, ...song.tracks.flatMap((t) => t.notes)];
  return notes.length ? Math.max(...notes.map((n) => n.start + n.duration)) : 0;
}
