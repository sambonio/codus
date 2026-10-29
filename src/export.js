// GarageBand export: a MIDI file of every note-based part plus WAV stems,
// all starting at bar 1, zipped together with a short how-to.
import { writeMidi } from './midi.js';

// ---------- WAV ----------

/**
 * Encode channels of float samples as a PCM WAV file. 24-bit at 44.1 or
 * 48 kHz is what GarageBand records natively, so it imports without conversion.
 */
export function encodeWav(channels, sampleRate, { bitDepth = 24 } = {}) {
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels.length * bytesPerSample;
  const dataSize = frames * blockAlign;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const ascii = (offset, text) => [...text].forEach((c, i) => (out[offset + i] = c.charCodeAt(0)));

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  const max = 2 ** (bitDepth - 1) - 1;
  let pos = 44;
  for (let i = 0; i < frames; i++) {
    for (const data of channels) {
      const v = Math.round(Math.max(-1, Math.min(1, data[i])) * max);
      if (bitDepth === 16) view.setInt16(pos, v, true);
      else {
        out[pos] = v & 0xff;
        out[pos + 1] = (v >> 8) & 0xff;
        out[pos + 2] = (v >> 16) & 0xff;
      }
      pos += bytesPerSample;
    }
  }
  return out;
}

// ---------- ZIP ----------

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * files: [{ name, data: Uint8Array | string }] -> Uint8Array of a .zip.
 * Entries are stored uncompressed: audio barely compresses and this keeps
 * the writer tiny. Finder and the iOS Files app both open it with a tap.
 */
export function makeZip(files, { date = new Date() } = {}) {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const data = typeof file.data === 'string' ? enc.encode(file.data) : file.data;
    const crc = crc32(data);
    const fields = (sig, central) => {
      const head = new Uint8Array((central ? 46 : 30) + name.length);
      const v = new DataView(head.buffer);
      let p = 0;
      const u16 = (x) => { v.setUint16(p, x, true); p += 2; };
      const u32 = (x) => { v.setUint32(p, x, true); p += 4; };
      u32(sig);
      if (central) u16(20); // version made by
      u16(20);              // version needed
      u16(0x0800);          // UTF-8 names
      u16(0);               // stored
      u16(dosTime);
      u16(dosDate);
      u32(crc);
      u32(data.length);
      u32(data.length);
      u16(name.length);
      u16(0);               // extra length
      if (central) {
        u16(0); u16(0); u16(0); // comment, disk, internal attrs
        u32(0);                 // external attrs
        u32(offset);
      }
      head.set(name, p);
      return head;
    };
    const local = fields(0x04034b50, false);
    locals.push(local, data);
    centrals.push(fields(0x02014b50, true));
    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, files.length, true);
  v.setUint16(10, files.length, true);
  v.setUint32(12, centralSize, true);
  v.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// ---------- Song layout ----------

/** Length in seconds, rounded up to whole 4/4 bars so stems loop cleanly. */
export function songLength(tracks, bpm, { tail = 0.5 } = {}) {
  let end = 0;
  for (const t of tracks) {
    for (const n of t.notes ?? []) end = Math.max(end, n.start + n.duration);
    if (t.audio) end = Math.max(end, (t.audio.at ?? 0) + t.audio.buffer.duration - (t.audio.offset ?? 0));
  }
  const bar = (4 * 60) / bpm;
  return Math.max(1, Math.ceil((end + tail) / bar)) * bar;
}

/** Turn a track name into a safe, readable file name. */
export function fileName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Track';
}

// ---------- Rendering (browser only) ----------

/**
 * Render tracks offline into one AudioBuffer. A track sounds if it has
 * `play` (a note player, as in synth.js / sampler.js) with `notes`, or
 * `audio`: { buffer, offset = 0 (seconds into the buffer), at = 0 (song time) }.
 */
export async function renderTracks(tracks, { sampleRate, length, channels = 2 }) {
  const ctx = new OfflineAudioContext(channels, Math.ceil(length * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const compressor = ctx.createDynamicsCompressor();
  master.connect(compressor).connect(ctx.destination);
  for (const t of tracks) {
    const bus = ctx.createGain();
    bus.gain.value = t.gain ?? 1;
    bus.connect(master);
    if (t.play) for (const note of t.notes ?? []) t.play(ctx, bus, note);
    if (t.audio) {
      const source = ctx.createBufferSource();
      source.buffer = t.audio.buffer;
      source.connect(bus);
      source.start(t.audio.at ?? 0, t.audio.offset ?? 0);
    }
  }
  return ctx.startRendering();
}

function bufferChannels(buffer) {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}

/**
 * Build the GarageBand pack as zip bytes.
 * tracks: [{ name, notes?, program?, drums?, play?, gain?, audio?, stem = true }]
 * Note tracks go into the MIDI file (with their GM program); every track that
 * makes sound also gets its own WAV stem, and there's a full mix too.
 */
export async function buildGarageBandPack({ title = 'Hummagroove', bpm, tracks, sampleRate = 44100, onProgress = () => {} }) {
  const length = songLength(tracks, bpm);
  const files = [];
  const midiTracks = tracks.filter((t) => t.notes?.length);
  if (midiTracks.length) files.push({ name: `${title}.mid`, data: writeMidi(midiTracks, { bpm }) });

  const audible = tracks.filter((t) => t.stem !== false && ((t.play && t.notes?.length) || t.audio));
  const used = new Set();
  for (const [i, t] of audible.entries()) {
    onProgress(`Rendering ${t.name} (${i + 1} of ${audible.length})…`);
    let name = fileName(t.name);
    for (let n = 2; used.has(name); n++) name = `${fileName(t.name)} ${n}`;
    used.add(name);
    const buffer = await renderTracks([t], { sampleRate, length });
    files.push({ name: `Stems/${name}.wav`, data: encodeWav(bufferChannels(buffer), sampleRate) });
  }
  if (audible.length > 1) {
    onProgress('Rendering the full mix…');
    const mix = await renderTracks(audible, { sampleRate, length });
    files.push({ name: `${title} mix.wav`, data: encodeWav(bufferChannels(mix), sampleRate) });
  }
  files.push({ name: 'How to open in GarageBand.txt', data: howTo({ title, bpm, length, files }) });
  return makeZip(files);
}

function howTo({ title, bpm, length, files }) {
  const bars = Math.round(length / ((4 * 60) / bpm));
  return [
    `${title}: exported from Hummagroove`,
    `Tempo ${bpm} BPM, 4/4, ${bars} bars. Every file starts at bar 1.`,
    '',
    'Files:',
    ...files.map((f) => `  ${f.name}`),
    '',
    'GarageBand on Mac:',
    `  1. Create an Empty Project and set the tempo to ${bpm} BPM.`,
    `  2. Drag ${title}.mid into the empty area below the tracks. GarageBand`,
    '     makes one software instrument track per part, ready to re-voice.',
    '  3. Drag the WAV files from Stems onto empty space and line each up at bar 1.',
    '',
    'GarageBand on iPhone or iPad:',
    '  1. Unzip this file in the Files app (tap it).',
    `  2. Make a new song, set the tempo to ${bpm} BPM, and open the Tracks view.`,
    '  3. Tap the loop browser, choose Files, and drag the .mid or a WAV',
    '     to the start of an empty track.',
    '',
  ].join('\n');
}

/** Save bytes as a download. */
export function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
