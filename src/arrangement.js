// Song sections: hum a verse, a chorus, a bridge... and play them in any
// order, with repeats. Pure functions, no audio.
//
//   section = { id, name, melody }   melody times start at 0 (seconds)
//   order   = [sectionId, ...]       the song, first to last
//
// Every section starts on a bar line, so the generated parts stay in time
// when sections are joined.
import { arrange, detectKey } from './notes.js';

export function barLength(bpm) {
  return (4 * 60) / bpm;
}

/** How many whole bars a section takes (at least one). */
export function sectionBars(section, bpm) {
  const end = Math.max(0, ...section.melody.map((n) => n.start + n.duration));
  return Math.max(1, Math.ceil(end / barLength(bpm) - 1e-6));
}

/**
 * Lay the sections out in order. One key is detected across all of them, so
 * the chords agree from section to section. Returns
 * { key, melody, parts: { bass, keys }, markers: [{ sectionId, name, start, end }] }.
 */
export function buildTimeline(sections, order, { bpm, bassMode, keysMode, key } = {}) {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const used = order.map((id) => byId.get(id)).filter(Boolean);
  const songKey = key ?? detectKey([...new Set(used)].flatMap((s) => s.melody));
  const bar = barLength(bpm);
  const melody = [];
  const parts = { bass: [], keys: [] };
  const markers = [];
  let at = 0;
  for (const section of used) {
    const arranged = arrange(section.melody, { bassMode, keysMode, key: songKey });
    const shift = (notes) => notes.map((n) => ({ ...n, start: n.start + at }));
    melody.push(...shift(section.melody));
    parts.bass.push(...shift(arranged.bass));
    parts.keys.push(...shift(arranged.keys));
    const end = at + sectionBars(section, bpm) * bar;
    markers.push({ sectionId: section.id, name: section.name, start: at, end });
    at = end;
  }
  return { key: songKey, melody, parts, markers };
}

const DEFAULT_NAMES = ['Verse', 'Chorus', 'Bridge', 'Intro', 'Outro'];
let nextSectionId = 1;

/** Make a new section from a hummed melody, named after what's missing. */
export function createSection(sections, melody, name) {
  const taken = new Set(sections.map((s) => s.name));
  const fallback = DEFAULT_NAMES.find((n) => !taken.has(n)) ?? `Part ${sections.length + 1}`;
  return { id: `section-${nextSectionId++}`, name: name ?? fallback, melody };
}

/** Move the order entry at `from` to `to`. Returns a new order. */
export function moveInOrder(order, from, to) {
  const next = order.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

/** Drop a section and every place it appears in the order. */
export function removeSection(sections, order, id) {
  return { sections: sections.filter((s) => s.id !== id), order: order.filter((o) => o !== id) };
}
