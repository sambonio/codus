// GarageBand export: a MIDI file of every note-based part plus WAV stems,
// all starting at bar 1, zipped together with a short how-to.
import { writeMidi } from './midi.js';
import { playParts, roomImpulse } from './synth.js';

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

/**
 * A track to export:
 *   { name, notes?, program?, drums?, midi = true,      // MIDI part
 *     play?, release?, volume = 1, pan = 0, reverb = 0, // how it sounds
 *     clips?: [{ buffer, offset = 0, at = 0, duration? }], // recorded audio
 *     mixGain = volume, stem = true }
 * `play` is a loaded instrument's play(ctx, out, note) with its samples
 * already prepared. Clips place an AudioBuffer at song time `at`, starting
 * `offset` seconds into it. `mixGain` is the level in the full mix (0 when
 * muted or soloed out); stems always use `volume`.
 */

/** Seconds per 4/4 bar. */
export const barLength = (bpm) => (4 * 60) / bpm;

function clipEnd(clip) {
  const available = clip.buffer.duration - (clip.offset ?? 0);
  return (clip.at ?? 0) + Math.min(available, clip.duration ?? available);
}

/** Length in seconds, rounded up to whole bars so stems line up and loop cleanly. */
export function packLength(tracks, bpm, { markers = [], tail = 0.5 } = {}) {
  let end = Math.max(0, ...markers.map((m) => m.end ?? m.start));
  for (const t of tracks) {
    for (const n of t.notes ?? []) end = Math.max(end, n.start + n.duration + tail);
    for (const c of t.clips ?? []) end = Math.max(end, clipEnd(c));
  }
  const bar = barLength(bpm);
  return Math.max(1, Math.ceil(end / bar - 1e-6)) * bar;
}

/** Turn a track name into a safe, readable file name. */
export function fileName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'Track';
}

/** Give each name a unique, numbered file name: "Strings", "Strings 2". */
export function uniqueNames(names) {
  const used = new Set();
  return names.map((name) => {
    const base = fileName(name);
    let unique = base;
    for (let n = 2; used.has(unique.toLowerCase()); n++) unique = `${base} ${n}`;
    used.add(unique.toLowerCase());
    return unique;
  });
}

const sounds = (t) => (t.play && t.notes?.length) || t.clips?.length;

// ---------- Rendering (browser only) ----------

function scheduleClips(ctx, clips, out) {
  for (const clip of clips ?? []) {
    const source = ctx.createBufferSource();
    source.buffer = clip.buffer;
    source.connect(out);
    source.start(clip.at ?? 0, clip.offset ?? 0, clip.duration);
  }
}

/**
 * Render one track on its own: its level, pan and room reverb, but none of
 * the mix bus processing, so the stems can be mixed afresh in GarageBand.
 */
export async function renderStem(track, { sampleRate, length }) {
  const ctx = new OfflineAudioContext(2, Math.ceil(length * sampleRate), sampleRate);
  const bus = ctx.createGain();
  bus.gain.value = track.volume ?? 1;
  const panner = ctx.createStereoPanner();
  panner.pan.value = track.pan ?? 0;
  bus.connect(panner).connect(ctx.destination);
  if (track.reverb) {
    const send = ctx.createGain();
    send.gain.value = track.reverb;
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx);
    bus.connect(send).connect(room).connect(panner);
  }
  if (track.play) for (const note of track.notes ?? []) track.play(ctx, bus, note);
  scheduleClips(ctx, track.clips, bus);
  const buffer = await ctx.startRendering();
  track.release?.(bus);
  return buffer;
}

/** Render the whole song exactly as the app plays it, mix bus included. */
export async function renderMix(tracks, { sampleRate, length }) {
  const ctx = new OfflineAudioContext(2, Math.ceil(length * sampleRate), sampleRate);
  const parts = tracks.filter((t) => t.play && t.notes?.length).map((t, i) => ({
    id: i, notes: t.notes, play: t.play, release: t.release,
    gain: t.mixGain ?? t.volume ?? 1, pan: t.pan ?? 0, reverb: t.reverb ?? 0,
  }));
  const handle = playParts(ctx, parts, { offset: 0 });
  for (const t of tracks) {
    if (!t.clips?.length) continue;
    const gain = ctx.createGain();
    gain.gain.value = t.mixGain ?? t.volume ?? 1;
    gain.connect(ctx.destination);
    scheduleClips(ctx, t.clips, gain);
  }
  const buffer = await ctx.startRendering();
  handle.stop();
  return buffer;
}

function bufferChannels(buffer) {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}

/**
 * Build the GarageBand pack as zip bytes: one MIDI file with a track per
 * note part (and the song's sections as markers), a WAV stem per track that
 * makes sound, the full mix, and a how-to.
 */
export async function buildGarageBandPack({
  title = 'Hummagroove', bpm, tracks, markers = [], sampleRate = 44100, onProgress = () => {},
}) {
  const length = packLength(tracks, bpm, { markers });
  const files = [];
  const midiTracks = tracks.filter((t) => t.midi !== false && t.notes?.length);
  if (midiTracks.length) files.push({ name: `${title}.mid`, data: writeMidi(midiTracks, { bpm, markers }) });

  const stems = tracks.filter((t) => t.stem !== false && sounds(t));
  const names = uniqueNames(stems.map((t) => t.name));
  for (const [i, t] of stems.entries()) {
    onProgress(`Rendering ${t.name} (${i + 1} of ${stems.length})…`);
    const buffer = await renderStem(t, { sampleRate, length });
    files.push({ name: `Stems/${String(i + 1).padStart(2, '0')} ${names[i]}.wav`, data: encodeWav(bufferChannels(buffer), sampleRate) });
  }
  if (stems.length) {
    onProgress('Rendering the full mix…');
    const mix = await renderMix(stems, { sampleRate, length });
    files.push({ name: `${title} mix.wav`, data: encodeWav(bufferChannels(mix), sampleRate) });
  }
  files.push({ name: 'How to open in GarageBand.txt', data: howTo({ title, bpm, length, files, markers }) });
  return makeZip(files);
}

/** "Verse: bar 1", using the 4/4 bar the section starts on. */
export function sectionBars(markers, bpm) {
  const bar = barLength(bpm);
  return markers.map((m) => `${m.name}: bar ${Math.round(m.start / bar) + 1}`);
}

function howTo({ title, bpm, length, files, markers }) {
  const bars = Math.round(length / barLength(bpm));
  return [
    `${title}: exported from Hummagroove`,
    `Tempo ${bpm} BPM, 4/4, ${bars} bars. Every file starts at bar 1.`,
    '',
    'Files:',
    ...files.map((f) => `  ${f.name}`),
    ...(markers.length ? ['', 'Sections:', ...sectionBars(markers, bpm).map((s) => `  ${s}`)] : []),
    '',
    'GarageBand on Mac:',
    `  1. Create an Empty Project and set the tempo to ${bpm} BPM.`,
    `  2. Drag ${title}.mid into the empty area below the tracks. GarageBand`,
    '     makes one software instrument track per part, ready to re-voice.',
    '  3. Select all the WAV files in Stems and drag them in together at bar 1.',
    '     Each lands on its own audio track, ready to mix.',
    '  4. Use the stems for the sound you made here, or the MIDI tracks to swap',
    '     in GarageBand instruments. Mute whichever you are not using.',
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
