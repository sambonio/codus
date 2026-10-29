// The instrument catalogue. Every track picks one of these by id.
//
// An instrument, once loaded, is { name, play(ctx, out, note), credit?,
// reverb?, controls?, prepare?(notes), release?(out) } where note is
// { midi, start, duration, velocity } with times in AudioContext seconds.
// prepare() fetches whatever samples those notes need and must be awaited
// before play(). `controls` lists extra per-track settings (e.g. Leslie
// speed) as { id, label, options: [[value, label]] }, read and written as
// properties on the instrument.
import { loadMultisampler } from './multisampler.js';
import { playSynthBassNote, playKeysNote } from '../synth.js';
import { createOrgan, ORGAN_PRESETS } from './organ.js';
import { GM_INSTRUMENTS, createGmInstrument } from './gm.js';

const SAMPLES = new URL('../../samples/', import.meta.url);

export const INSTRUMENTS = [
  { id: 'electric-bass', name: 'Electric bass', role: 'bass', gmProgram: 33,
    load: (ctx) => loadMultisampler(ctx, new URL('electric-bass/', SAMPLES).href, { level: 0.9, reverb: 0.04 }) },
  { id: 'upright-bass', name: 'Upright bass', role: 'bass', gmProgram: 32,
    load: (ctx) => loadMultisampler(ctx, new URL('upright-bass/', SAMPLES).href, { level: 0.85, reverb: 0.1 }) },
  { id: 'synth-bass', name: 'Synth bass', role: 'bass', gmProgram: 38,
    load: async () => ({ name: 'Synth bass', play: playSynthBassNote }) },
  ...Object.entries(ORGAN_PRESETS).map(([preset, { name }]) => ({
    id: `organ-${preset}`, name, role: 'keys', gmProgram: 16,
    load: async () => createOrgan(preset),
  })),
  { id: 'electric-piano', name: 'Electric piano (synth)', role: 'keys', gmProgram: 4,
    load: async () => ({ name: 'Electric piano (synth)', reverb: 0.12, play: playKeysNote }) },
  // The General MIDI library, fetched note by note when used.
  ...GM_INSTRUMENTS.map(([soundfontId, name, family], program) => ({
    id: `gm-${soundfontId}`, name, family, gmProgram: program,
    load: async (ctx) => createGmInstrument(ctx, soundfontId, name, family),
  })),
];

export function getInstrument(id) {
  return INSTRUMENTS.find((i) => i.id === id);
}

export function instrumentsFor(role) {
  return INSTRUMENTS.filter((i) => i.role === role);
}

/**
 * Instruments grouped for a picker: the hand-built ones for this role first
 * (real basses, organs), then the rest of the hand-built ones, then the
 * General MIDI library by family. Returns [[groupLabel, instruments]].
 */
export function instrumentGroups(role) {
  const own = INSTRUMENTS.filter((i) => i.role && i.role === role);
  const otherOwn = INSTRUMENTS.filter((i) => i.role && i.role !== role);
  const groups = [['Recommended', own], ['Studio instruments', otherOwn]];
  const families = new Map();
  for (const inst of INSTRUMENTS.filter((i) => i.family)) {
    if (!families.has(inst.family)) families.set(inst.family, []);
    families.get(inst.family).push(inst);
  }
  for (const [family, list] of families) groups.push([family, list]);
  return groups.filter(([, list]) => list.length);
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
