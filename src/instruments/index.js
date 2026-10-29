// The instrument catalogue. Every track picks one of these by id.
//
// An instrument, once loaded, is { name, credit?, play(ctx, out, note) } where
// note is { midi, start, duration, velocity } with times in AudioContext seconds.
import { loadMultisampler } from './multisampler.js';
import { playSynthBassNote, playKeysNote } from '../synth.js';

const SAMPLES = new URL('../../samples/', import.meta.url);

export const INSTRUMENTS = [
  { id: 'electric-bass', name: 'Electric bass', role: 'bass', gmProgram: 33,
    load: (ctx) => loadMultisampler(ctx, new URL('electric-bass/', SAMPLES).href, { level: 0.9 }) },
  { id: 'upright-bass', name: 'Upright bass', role: 'bass', gmProgram: 32,
    load: (ctx) => loadMultisampler(ctx, new URL('upright-bass/', SAMPLES).href, { level: 0.85 }) },
  { id: 'synth-bass', name: 'Synth bass', role: 'bass', gmProgram: 38,
    load: async () => ({ name: 'Synth bass', play: playSynthBassNote }) },
  { id: 'electric-piano', name: 'Electric piano', role: 'keys', gmProgram: 4,
    load: async () => ({ name: 'Electric piano', play: playKeysNote }) },
];

export function getInstrument(id) {
  return INSTRUMENTS.find((i) => i.id === id);
}

export function instrumentsFor(role) {
  return INSTRUMENTS.filter((i) => i.role === role);
}

const loaded = new WeakMap(); // AudioContext -> Map(id -> Promise<instrument>)

/** Load an instrument once per AudioContext. A failed load can be retried. */
export function loadInstrument(ctx, id) {
  const entry = getInstrument(id);
  if (!entry) return Promise.reject(new Error(`Unknown instrument: ${id}`));
  let byId = loaded.get(ctx);
  if (!byId) loaded.set(ctx, (byId = new Map()));
  if (!byId.has(id)) {
    const promise = entry.load(ctx);
    promise.catch(() => byId.delete(id));
    byId.set(id, promise);
  }
  return byId.get(id);
}
