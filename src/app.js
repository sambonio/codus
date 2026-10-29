import { detectPitchTrack, downsample } from './pitch.js';
import { segmentNotes, quantizeNotes, arrange, detectKey, midiToName } from './notes.js';
import { playSynthBassNote, playKeysNote, playParts } from './synth.js';
import { SAMPLED_BASSES, loadSampledBass, sampledBassPlayer } from './sampler.js';
import { writeMidi } from './midi.js';
import { buildGarageBandPack, download } from './export.js';

const $ = (id) => document.getElementById(id);
const ui = {
  record: $('record'), file: $('file'), timer: $('timer'), meter: $('meter'),
  bassMode: $('bassMode'), bassSound: $('bassSound'), keysMode: $('keysMode'), quantize: $('quantize'),
  bpm: $('bpm'), transpose: $('transpose'), summary: $('summary'), roll: $('roll'),
  play: $('play'), stop: $('stop'), loop: $('loop'), midi: $('midi'),
  garageband: $('garageband'), exportStatus: $('exportStatus'),
  playBass: $('playBass'), playKeys: $('playKeys'), playVoice: $('playVoice'),
};

let audioCtx = null;
const state = {
  recording: null, // AudioBuffer of the captured voice
  rawNotes: [],    // notes as sung, times relative to the recording
  arrangement: null,
  playback: null,
};

function getCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ---------- Capture ----------

let recorder = null;
let meterRaf = 0;

async function startRecording() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
  } catch (err) {
    ui.summary.textContent = `Couldn't open the microphone: ${err.message}`;
    return;
  }

  const ctx = getCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const meterCtx = ui.meter.getContext('2d');
  const startedAt = performance.now();
  const drawMeter = () => {
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    meterCtx.clearRect(0, 0, ui.meter.width, ui.meter.height);
    meterCtx.fillStyle = getComputedStyle(document.body).getPropertyValue('--accent');
    meterCtx.fillRect(0, 0, ui.meter.width * Math.min(1, peak * 1.5), ui.meter.height);
    ui.timer.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
    meterRaf = requestAnimationFrame(drawMeter);
  };
  drawMeter();

  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    cancelAnimationFrame(meterRaf);
    meterCtx.clearRect(0, 0, ui.meter.width, ui.meter.height);
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: recorder.mimeType });
    recorder = null;
    await analyseBlob(blob);
  };
  recorder.start();
  ui.record.textContent = '■ Stop recording';
  ui.record.classList.add('recording');
  stopPlayback();
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  ui.record.textContent = '● Record';
  ui.record.classList.remove('recording');
}

ui.record.addEventListener('click', () => (recorder ? stopRecording() : startRecording()));

ui.file.addEventListener('change', async () => {
  const file = ui.file.files[0];
  if (file) await analyseBlob(file);
  ui.file.value = '';
});

// ---------- Analysis ----------

async function analyseBlob(blob) {
  ui.summary.textContent = 'Listening for notes…';
  const ctx = getCtx();
  let audio;
  try {
    audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    ui.summary.textContent = "Couldn't decode that audio. Try recording again or another file.";
    return;
  }
  state.recording = audio;

  // Mix to mono.
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
  }

  // Let the status message paint before the heavy loop.
  await new Promise((r) => setTimeout(r, 20));
  const { samples, sampleRate } = downsample(mono, audio.sampleRate, 16000);
  const track = detectPitchTrack(samples, sampleRate, { frameSize: 1024, hopSize: 256, minFreq: 55, maxFreq: 1000 });
  state.rawNotes = segmentNotes(track);
  rebuild();
  if (SAMPLED_BASSES[ui.bassSound.value]) loadSampledBass(ctx, ui.bassSound.value).catch(() => {});
}

function rebuild() {
  stopPlayback();
  const raw = state.rawNotes;
  if (raw.length === 0) {
    state.arrangement = null;
    ui.summary.textContent = state.recording
      ? "Didn't catch any notes. Try humming a bit louder and closer to the mic."
      : 'Record something to get started.';
    setPlayable(false);
    drawRoll();
    return;
  }

  const transpose = Number(ui.transpose.value) || 0;
  const bpm = clampBpm();
  const origin = raw[0].start;
  let melody = raw.map((n) => ({ ...n, midi: n.midi + transpose, start: n.start - origin }));
  if (ui.quantize.checked) melody = quantizeNotes(melody, { bpm, division: 2 });

  const key = detectKey(melody);
  const { bass, keys } = arrange(melody, { bassMode: ui.bassMode.value, keysMode: ui.keysMode.value, key });
  state.arrangement = { melody, bass, keys, key, origin, bpm };

  const range = `${midiToName(Math.min(...melody.map((n) => n.midi)))}–${midiToName(Math.max(...melody.map((n) => n.midi)))}`;
  ui.summary.textContent = `${melody.length} notes, range ${range}, sounds like ${key.name}.`;
  setPlayable(true);
  drawRoll();
}

function clampBpm() {
  const bpm = Math.min(220, Math.max(40, Number(ui.bpm.value) || 100));
  return bpm;
}

function setPlayable(on) {
  ui.play.disabled = !on;
  ui.midi.disabled = !on;
  ui.garageband.disabled = !on;
}

for (const el of [ui.bassMode, ui.keysMode, ui.quantize, ui.bpm, ui.transpose]) {
  el.addEventListener('change', rebuild);
}

// ---------- Playback ----------

function arrangementLength(a) {
  return Math.max(...[...a.melody, ...a.bass, ...a.keys].map((n) => n.start + n.duration));
}

// Resolves to a note-playing function for the chosen bass sound,
// loading its samples the first time it's used.
async function bassInstrument(ctx) {
  const name = ui.bassSound.value;
  if (!SAMPLED_BASSES[name]) return playSynthBassNote;
  return sampledBassPlayer(name, await loadSampledBass(ctx, name));
}

let playRequest = 0;

async function startPlayback() {
  const a = state.arrangement;
  if (!a) return;
  stopPlayback();
  const ctx = getCtx();
  const request = ++playRequest;
  const parts = [];
  if (ui.playBass.checked) {
    let playBass;
    try {
      ui.play.textContent = '… Loading bass';
      playBass = await bassInstrument(ctx);
    } catch (err) {
      ui.summary.textContent = `Couldn't load the ${ui.bassSound.selectedOptions[0].text} samples (${err.message}). Using the synth bass instead.`;
      playBass = playSynthBassNote;
    } finally {
      ui.play.textContent = '▶ Play';
    }
    // Another play or stop happened while loading.
    if (request !== playRequest || state.playback) return;
    parts.push({ notes: a.bass, play: playBass, gain: 1 });
  }
  if (ui.playKeys.checked) parts.push({ notes: a.keys, play: playKeysNote, gain: 0.9 });
  const handle = playParts(ctx, parts);

  let voice = null;
  if (ui.playVoice.checked && state.recording) {
    voice = ctx.createBufferSource();
    voice.buffer = state.recording;
    voice.connect(ctx.destination);
    voice.start(handle.startTime, a.origin);
  }

  const length = arrangementLength(a) + 0.4;
  state.playback = { handle, voice, startTime: handle.startTime, length };
  ui.stop.disabled = false;
  animatePlayhead();
}

function stopPlayback() {
  playRequest++;
  const p = state.playback;
  if (!p) return;
  p.handle.stop();
  if (p.voice) try { p.voice.stop(); } catch { /* already stopped */ }
  state.playback = null;
  ui.stop.disabled = true;
  drawRoll();
}

function animatePlayhead() {
  const p = state.playback;
  if (!p) return;
  const elapsed = audioCtx.currentTime - p.startTime;
  if (elapsed >= p.length) {
    stopPlayback();
    if (ui.loop.checked) startPlayback();
    return;
  }
  drawRoll(Math.max(0, elapsed));
  requestAnimationFrame(animatePlayhead);
}

ui.play.addEventListener('click', startPlayback);
// Start fetching samples as soon as a sound is picked, so Play is instant.
ui.bassSound.addEventListener('change', () => {
  if (SAMPLED_BASSES[ui.bassSound.value]) loadSampledBass(getCtx(), ui.bassSound.value).catch(() => {});
});
ui.stop.addEventListener('click', stopPlayback);

// ---------- Export ----------

// General MIDI programs (0-based): Acoustic Bass, Electric Bass (finger), Synth Bass 1.
const GM_BASS_PROGRAMS = { upright: 32, electric: 33, synth: 38 };

/**
 * Every part of the song, in the shape export.js takes. New instruments or
 * recorded tracks only need to add an entry here to be exported.
 */
async function songTracks(a, { sound = false } = {}) {
  const tracks = [
    { name: 'Melody', notes: a.melody, program: 0, stem: false },
    {
      name: 'Bass', notes: a.bass, program: GM_BASS_PROGRAMS[ui.bassSound.value] ?? 33,
      play: sound ? await bassInstrument(getCtx()).catch(() => playSynthBassNote) : null, gain: 1,
    },
    { name: 'Keys', notes: a.keys, program: 4, play: playKeysNote, gain: 0.9 }, // Electric Piano 1
  ];
  if (state.recording) tracks.push({ name: 'Voice', audio: { buffer: state.recording, offset: a.origin } });
  return tracks;
}

ui.midi.addEventListener('click', async () => {
  const a = state.arrangement;
  if (!a) return;
  const tracks = (await songTracks(a)).filter((t) => t.notes);
  download(writeMidi(tracks, { bpm: a.bpm }), 'hummagroove.mid', 'audio/midi');
});

ui.garageband.addEventListener('click', async () => {
  const a = state.arrangement;
  if (!a) return;
  ui.garageband.disabled = true;
  const status = (text) => (ui.exportStatus.textContent = text);
  try {
    status('Loading instruments…');
    const tracks = await songTracks(a, { sound: true });
    const zip = await buildGarageBandPack({
      title: 'Hummagroove', bpm: a.bpm, tracks, sampleRate: getCtx().sampleRate, onProgress: status,
    });
    download(zip, 'hummagroove-garageband.zip', 'application/zip');
    status('Done. Unzip it and drag the files into GarageBand at bar 1.');
  } catch (err) {
    status(`Export failed: ${err.message}`);
  } finally {
    ui.garageband.disabled = !state.arrangement;
  }
});

// ---------- Piano roll ----------

function drawRoll(playhead = null) {
  const canvas = ui.roll;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  const css = getComputedStyle(document.body);
  const color = (name) => css.getPropertyValue(name).trim();

  const a = state.arrangement;
  if (!a) return;

  const all = [...a.melody, ...a.bass, ...a.keys];
  const low = Math.min(...all.map((n) => n.midi)) - 1;
  const high = Math.max(...all.map((n) => n.midi)) + 1;
  const length = arrangementLength(a);
  const pad = 32;
  const x = (t) => pad + (t / length) * (width - pad - 8);
  const rowH = (height - 8) / (high - low + 1);
  const y = (m) => 4 + (high - m) * rowH;

  // Grid: C rows and beat lines.
  g.font = '10px system-ui';
  for (let m = low; m <= high; m++) {
    if (m % 12 === 0) {
      g.fillStyle = color('--grid');
      g.fillRect(pad, y(m), width - pad, rowH);
      g.fillStyle = color('--muted');
      g.fillText(midiToName(m), 2, y(m) + rowH);
    }
  }
  g.strokeStyle = color('--grid');
  const beat = 60 / a.bpm;
  for (let t = 0; t <= length; t += beat) {
    g.beginPath();
    g.moveTo(x(t), 0);
    g.lineTo(x(t), height);
    g.stroke();
  }

  const drawNotes = (notes, fill, alpha) => {
    g.globalAlpha = alpha;
    g.fillStyle = fill;
    for (const n of notes) {
      g.fillRect(x(n.start), y(n.midi) + 1, Math.max(2, x(n.start + n.duration) - x(n.start) - 1), Math.max(2, rowH - 2));
    }
    g.globalAlpha = 1;
  };
  drawNotes(a.keys, color('--keys'), 0.85);
  drawNotes(a.bass, color('--bass'), 0.9);
  drawNotes(a.melody, color('--melody'), 0.35);

  if (playhead !== null) {
    g.strokeStyle = color('--accent');
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x(playhead), 0);
    g.lineTo(x(playhead), height);
    g.stroke();
    g.lineWidth = 1;
  }
}

window.addEventListener('resize', () => drawRoll());
drawRoll();
