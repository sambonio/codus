// The song model: the hummed melody plus the instrument tracks built from it.
//
//   song  = { bpm, key, origin, melody, tracks, markers? }
//   track = { id, name, role, instrument, notes, volume, pan, muted, solo, part? }
//
// `origin` is where the melody starts in the original recording (seconds),
// and every note time is relative to it. `instrument` is an id from
// src/instruments/index.js. Roles: 'bass' and 'keys' are the two lines
// arranged from the melody; 'extra' tracks are added with the instrument
// builder and play a generated `part` (see src/parts.js). Track settings the
// user changes survive re-arranging, and extra tracks are regenerated from
// the new melody. Tracks with any other role are carried over untouched.
// `markers` are the song's sections in order (see src/arrangement.js).
import { generatePart } from './parts.js';

export const DEFAULT_TRACKS = [
  { id: 'bass', name: 'Bass', role: 'bass', instrument: 'electric-bass', volume: 0.9, pan: 0, muted: false, solo: false },
  { id: 'keys', name: 'Keys', role: 'keys', instrument: 'organ-gospel', volume: 0.8, pan: 0, muted: false, solo: false },
];

/**
 * Build a song from an arranged melody. `previous` is the old track list,
 * whose user settings and extra tracks carry over.
 */
export function buildSong({ melody, key, bpm, origin, parts, markers = [] }, previous = []) {
  const byId = new Map(previous.map((t) => [t.id, t]));
  const tracks = DEFAULT_TRACKS.map((defaults) => {
    const old = byId.get(defaults.id);
    const settings = old ? { instrument: old.instrument, volume: old.volume, pan: old.pan, muted: old.muted, solo: old.solo } : {};
    return { ...defaults, ...settings, notes: parts[defaults.id] ?? [] };
  });
  const song = { bpm, key, origin, melody, tracks, markers };
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
    volume: 0.7, pan: 0, muted: false, solo: false, notes: generatePart(part, song),
  };
  song.tracks.push(track);
  return track;
}

/** Change what an extra track plays. */
export function setTrackPart(song, track, part) {
  track.part = part;
  track.notes = generatePart(part, song);
}

/** A track's playing level: muted, or silenced when another track is soloed. */
export function audibleGain(track, tracks) {
  if (track.muted) return 0;
  if (tracks.some((t) => t.solo) && !track.solo) return 0;
  return track.volume;
}

/** Where the song ends: the last section's bar line, or the last note. */
export function songLength(song) {
  const end = song.markers?.length ? song.markers[song.markers.length - 1].end : 0;
  const notes = [...song.melody, ...song.tracks.flatMap((t) => t.notes)];
  return Math.max(end, ...notes.map((n) => n.start + n.duration));
}
