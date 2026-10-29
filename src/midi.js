// Minimal Standard MIDI File (type 1) writer so parts can be opened in a DAW.

const PPQ = 480;
const DRUM_CHANNEL = 9;

function varLen(value) {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  while ((v >>= 7)) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

function u32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function chunk(type, data) {
  return [...[...type].map((c) => c.charCodeAt(0)), ...u32(data.length), ...data];
}

function trackChunk(name, notes, channel, program, bpm) {
  const ticksPerSecond = (PPQ * bpm) / 60;
  const events = [];
  for (const n of notes) {
    const on = Math.round(n.start * ticksPerSecond);
    const off = Math.max(on + 1, Math.round((n.start + n.duration) * ticksPerSecond));
    const vel = Math.max(1, Math.min(127, Math.round((n.velocity ?? 0.8) * 127)));
    events.push({ tick: on, order: 1, bytes: [0x90 | channel, n.midi, vel] });
    events.push({ tick: off, order: 0, bytes: [0x80 | channel, n.midi, 0] });
  }
  // Note-offs before note-ons on the same tick so repeated notes retrigger.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const nameBytes = [...new TextEncoder().encode(name)];
  const data = [0x00, 0xff, 0x03, ...varLen(nameBytes.length), ...nameBytes];
  // Drum tracks on channel 10 use the GM drum map, so they need no program.
  if (channel !== DRUM_CHANNEL) data.push(0x00, 0xc0 | channel, program);
  let last = 0;
  for (const e of events) {
    data.push(...varLen(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(0x00, 0xff, 0x2f, 0x00);
  return chunk('MTrk', data);
}

/**
 * Give each track its own channel, skipping channel 10 (drums) unless the
 * track is a drum track, so GarageBand and other DAWs pick the right sounds.
 */
function assignChannels(tracks) {
  let next = 0;
  return tracks.map((t) => {
    if (t.drums) return DRUM_CHANNEL;
    if (next === DRUM_CHANNEL) next++;
    return next++ % 16;
  });
}

/** tracks: [{ name, notes, program, drums }] -> Uint8Array of a .mid file in 4/4. */
export function writeMidi(tracks, { bpm = 120 } = {}) {
  const usPerBeat = Math.round(60_000_000 / bpm);
  const tempoTrack = chunk('MTrk', [
    0x00, 0xff, 0x03, 0x05, ...[...'Tempo'].map((c) => c.charCodeAt(0)),
    0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // 4/4
    0x00, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff,
    0x00, 0xff, 0x2f, 0x00,
  ]);
  const header = chunk('MThd', [0x00, 0x01, 0x00, tracks.length + 1, (PPQ >> 8) & 0xff, PPQ & 0xff]);
  const channels = assignChannels(tracks);
  const body = tracks.map((t, i) => trackChunk(t.name, t.notes, channels[i], t.program ?? 0, bpm));
  return new Uint8Array([...header, ...tempoTrack, ...body.flat()]);
}
