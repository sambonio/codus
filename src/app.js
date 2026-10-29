import { detectPitchTrack, downsample } from './pitch.js';
import { segmentNotes, quantizeNotes, arrange, detectKey, midiToName } from './notes.js';
import { playSynthBassNote, playKeysNote, playParts } from './synth.js';
import { SAMPLED_BASSES, loadSampledBass, sampledBassPlayer } from './sampler.js';
import { writeMidi } from './midi.js';
import {
  createTake, takeEnd, takeStart, uniqueTakeName, assembleTake, takePeaks, takeToWav,
  estimateLatency, startCapture, startMetronome, playTakes,
} from './takes.js';

const $ = (id) => document.getElementById(id);
const ui = {
  record: $('record'), file: $('file'), timer: $('timer'), meter: $('meter'),
  bassMode: $('bassMode'), bassSound: $('bassSound'), keysMode: $('keysMode'), quantize: $('quantize'),
  bpm: $('bpm'), transpose: $('transpose'), summary: $('summary'), roll: $('roll'),
  play: $('play'), stop: $('stop'), loop: $('loop'), midi: $('midi'),
  playBass: $('playBass'), playKeys: $('playKeys'), playVoice: $('playVoice'),
  takeKind: $('takeKind'), recordTake: $('recordTake'), countIn: $('countIn'), click: $('click'),
  takeTimer: $('takeTimer'), takeMeter: $('takeMeter'), takeStatus: $('takeStatus'), takes: $('takes'),
};

let audioCtx = null;
const state = {
  recording: null, // AudioBuffer of the captured voice
  rawNotes: [],    // notes as sung, times relative to the recording
  arrangement: null,
  playback: null,
  takes: [],       // recorded audio tracks, see takes.js
  takeSession: null,
};

function getCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ---------- Capture ----------

let recorder = null;

/** Draw a live level meter for an audio node on a canvas until stop() is called. */
function startMeter(ctx, node, canvas, onFrame = () => {}) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  node.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const g = canvas.getContext('2d');
  let raf = 0;
  const draw = () => {
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = getComputedStyle(document.body).getPropertyValue('--accent');
    g.fillRect(0, 0, canvas.width * Math.min(1, peak * 1.5), canvas.height);
    onFrame();
    raf = requestAnimationFrame(draw);
  };
  draw();
  return {
    stop() {
      cancelAnimationFrame(raf);
      g.clearRect(0, 0, canvas.width, canvas.height);
      analyser.disconnect();
    },
  };
}

async function startRecording() {
  if (state.takeSession) return;
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
  const startedAt = performance.now();
  const meter = startMeter(ctx, source, ui.meter, () => {
    ui.timer.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
  });

  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    meter.stop();
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
  if (!state.takeSession) stopPlayback();
  const raw = state.rawNotes;
  if (raw.length === 0) {
    state.arrangement = null;
    ui.summary.textContent = state.recording
      ? "Didn't catch any notes. Try humming a bit louder and closer to the mic."
      : 'Record something to get started.';
    refreshPlayable();
    drawRoll();
    drawTakes();
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
  refreshPlayable();
  drawRoll();
  drawTakes();
}

function clampBpm() {
  const bpm = Math.min(220, Math.max(40, Number(ui.bpm.value) || 100));
  return bpm;
}

function refreshPlayable() {
  ui.play.disabled = !state.arrangement && state.takes.length === 0;
  ui.midi.disabled = !state.arrangement;
}

for (const el of [ui.bassMode, ui.keysMode, ui.quantize, ui.bpm, ui.transpose]) {
  el.addEventListener('change', rebuild);
}

// ---------- Playback ----------

function arrangementLength(a) {
  return Math.max(...[...a.melody, ...a.bass, ...a.keys].map((n) => n.start + n.duration));
}

/** Length of the whole song in seconds: the arrangement plus any recorded takes. */
function songLength() {
  return Math.max(0, state.arrangement ? arrangementLength(state.arrangement) : 0, ...state.takes.map(takeEnd));
}

// Resolves to a note-playing function for the chosen bass sound,
// loading its samples the first time it's used.
async function bassInstrument(ctx) {
  const name = ui.bassSound.value;
  if (!SAMPLED_BASSES[name]) return playSynthBassNote;
  return sampledBassPlayer(name, await loadSampledBass(ctx, name));
}

let playRequest = 0;

// Resolves to the instruments for the generated parts, or null if another
// play or stop happened while samples were loading.
async function prepareParts(ctx) {
  const a = state.arrangement;
  const request = ++playRequest;
  const parts = [];
  if (!a) return parts;
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
    if (request !== playRequest || state.playback) return null;
    parts.push({ notes: a.bass, play: playBass, gain: 1 });
  }
  if (ui.playKeys.checked) parts.push({ notes: a.keys, play: playKeysNote, gain: 0.9 });
  return parts;
}

/**
 * Schedule everything with song time 0 `lead` seconds from now. `length` is
 * when the playhead stops (Infinity runs until stopPlayback()).
 */
function schedulePlayback(ctx, parts, { lead = 0.1, length = songLength() + 0.4 } = {}) {
  const a = state.arrangement;
  const handle = playParts(ctx, parts, { offset: lead });
  const takes = playTakes(ctx, state.takes, handle.startTime);

  let voice = null;
  if (a && ui.playVoice.checked && state.recording) {
    voice = ctx.createBufferSource();
    voice.buffer = state.recording;
    voice.connect(ctx.destination);
    voice.start(handle.startTime, a.origin);
  }

  state.playback = { handle, takes, voice, startTime: handle.startTime, length };
  ui.stop.disabled = false;
  animatePlayhead();
  return handle.startTime;
}

async function startPlayback() {
  if (state.takeSession) return;
  if (!state.arrangement && state.takes.length === 0) return;
  stopPlayback();
  const ctx = getCtx();
  const parts = await prepareParts(ctx);
  if (parts) schedulePlayback(ctx, parts);
}

function stopPlayback() {
  playRequest++;
  const p = state.playback;
  if (!p) return;
  p.handle.stop();
  p.takes.stop();
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
    if (state.takeSession) {
      stopTake();
      return;
    }
    stopPlayback();
    if (ui.loop.checked) startPlayback();
    return;
  }
  drawRoll(Math.max(0, elapsed));
  drawTakes(elapsed);
  requestAnimationFrame(animatePlayhead);
}

ui.play.addEventListener('click', startPlayback);
// Start fetching samples as soon as a sound is picked, so Play is instant.
ui.bassSound.addEventListener('change', () => {
  if (SAMPLED_BASSES[ui.bassSound.value]) loadSampledBass(getCtx(), ui.bassSound.value).catch(() => {});
});
ui.stop.addEventListener('click', () => (state.takeSession ? stopTake() : stopPlayback()));

// ---------- MIDI export ----------

// General MIDI programs (0-based): Acoustic Bass, Electric Bass (finger), Synth Bass 1.
const GM_BASS_PROGRAMS = { upright: 32, electric: 33, synth: 38 };

ui.midi.addEventListener('click', () => {
  const a = state.arrangement;
  if (!a) return;
  const bytes = writeMidi([
    { name: 'Melody', notes: a.melody, program: 0 },
    { name: 'Bass', notes: a.bass, program: GM_BASS_PROGRAMS[ui.bassSound.value] ?? 33 },
    { name: 'Keys', notes: a.keys, program: 4 },   // Electric Piano 1
  ], { bpm: a.bpm });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'hummagroove.mid';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---------- Recorded takes ----------

// The piano roll and the take lanes share a timeline: same left gutter, same scale.
const TIMELINE_PAD = 32;
const TIMELINE_RIGHT = 8;

async function recordTake() {
  if (state.takeSession || recorder) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Raw signal: processing meant for voice calls mangles drums and instruments.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    ui.takeStatus.textContent = `Couldn't open the microphone: ${err.message}`;
    return;
  }
  stopPlayback();
  const ctx = getCtx();
  const kind = ui.takeKind.value;
  const session = { stream, kind, starting: true };
  state.takeSession = session;
  setTakeRecordingUi(true);

  try {
    const parts = await prepareParts(ctx);
    session.capture = await startCapture(ctx, stream);
    if (state.takeSession !== session) { // stopped while starting
      await session.capture.stop();
      return;
    }
    const bpm = clampBpm();
    const beat = 60 / bpm;
    const countIn = ui.countIn.checked ? 4 : 0;
    const lead = 0.15 + countIn * beat;
    // Stop at the end of the arranged song; with only takes to play along to, record until Stop.
    const length = state.arrangement ? songLength() + 0.5 : Infinity;
    const songStart = schedulePlayback(ctx, parts || [], { lead, length });
    session.songStart = songStart;
    session.latency = estimateLatency(ctx, stream);
    session.metronome = startMetronome(ctx, {
      startTime: songStart - countIn * beat, bpm, countIn, enabled: () => ui.click.checked,
    });
    session.meter = startMeter(ctx, session.capture.source, ui.takeMeter, () => {
      const t = ctx.currentTime - songStart;
      ui.takeTimer.textContent = t < 0 ? `Count-in ${Math.ceil(-t / beat)}` : `${t.toFixed(1)}s`;
    });
    session.starting = false;
    ui.takeStatus.textContent = length < Infinity
      ? 'Recording along with the song. It stops by itself at the end, or press Stop.'
      : 'Recording. Press Stop when you are done.';
  } catch (err) {
    ui.takeStatus.textContent = `Couldn't start recording: ${err.message}`;
    endTakeSession(session);
  }
}

function endTakeSession(session) {
  session.metronome?.stop();
  session.meter?.stop();
  session.stream.getTracks().forEach((t) => t.stop());
  if (state.takeSession === session) state.takeSession = null;
  stopPlayback();
  setTakeRecordingUi(false);
}

async function stopTake() {
  const session = state.takeSession;
  if (!session) return;
  if (session.starting) {
    endTakeSession(session);
    return;
  }
  const ctx = audioCtx;
  const batches = await session.capture.stop();
  endTakeSession(session);
  const { samples, offset } = assembleTake(batches, {
    songStartFrame: Math.round(session.songStart * ctx.sampleRate),
    latencyFrames: Math.round(session.latency * ctx.sampleRate),
    sampleRate: ctx.sampleRate,
  });
  if (samples.length < ctx.sampleRate * 0.2) {
    ui.takeStatus.textContent = 'That take was too short to keep. Try again.';
    return;
  }
  const take = createTake({ kind: session.kind, name: uniqueTakeName(session.kind, state.takes), samples, sampleRate: ctx.sampleRate, offset });
  state.takes.push(take);
  ui.takeStatus.textContent = `Added "${take.name}" (${(samples.length / ctx.sampleRate).toFixed(1)}s). If it sounds early or late, adjust its timing in ms.`;
  renderTakes();
  refreshPlayable();
  drawRoll();
}

function setTakeRecordingUi(on) {
  ui.recordTake.textContent = on ? '■ Stop recording' : '● Record a take';
  ui.recordTake.classList.toggle('recording', on);
  ui.record.disabled = on;
  ui.play.disabled = on || (!state.arrangement && state.takes.length === 0);
  ui.stop.disabled = !on && !state.playback;
  if (!on) ui.takeTimer.textContent = '';
}

ui.recordTake.addEventListener('click', () => (state.takeSession ? stopTake() : recordTake()));

function downloadTake(take) {
  const url = URL.createObjectURL(new Blob([takeToWav(take)], { type: 'audio/wav' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${take.name.replace(/[^\w -]+/g, '').trim() || 'take'}.wav`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rebuild the list of takes with their controls. */
function renderTakes() {
  ui.takes.replaceChildren();
  for (const take of state.takes) {
    const el = document.createElement('div');
    el.className = 'take';
    el.classList.toggle('is-muted', take.muted);
    el.innerHTML = `
      <div class="row">
        <input class="take-name" aria-label="Track name">
        <label><input type="checkbox" class="mute"> Mute</label>
        <label>Volume <input type="range" class="gain" min="0" max="2" step="0.05"></label>
        <label>Timing <input type="number" class="nudge" min="-500" max="500" step="5"> ms</label>
        <button class="wav" title="Download as WAV, lined up to the start of the song">⬇ WAV</button>
        <button class="delete" aria-label="Delete take">✕</button>
      </div>
      <canvas aria-hidden="true"></canvas>`;
    const q = (sel) => el.querySelector(sel);
    q('.take-name').value = take.name;
    q('.mute').checked = take.muted;
    q('.gain').value = take.gain;
    q('.nudge').value = take.nudge;
    q('.take-name').addEventListener('change', (e) => { take.name = e.target.value.trim() || take.name; });
    q('.mute').addEventListener('change', (e) => {
      take.muted = e.target.checked;
      el.classList.toggle('is-muted', take.muted);
    });
    q('.gain').addEventListener('input', (e) => { take.gain = Number(e.target.value); });
    q('.nudge').addEventListener('change', (e) => {
      take.nudge = Math.max(-500, Math.min(500, Number(e.target.value) || 0));
      e.target.value = take.nudge;
      drawRoll();
      drawTakes();
    });
    q('.wav').addEventListener('click', () => downloadTake(take));
    q('.delete').addEventListener('click', () => {
      if (state.playback && !state.takeSession) stopPlayback();
      state.takes = state.takes.filter((t) => t !== take);
      renderTakes();
      refreshPlayable();
      drawRoll();
    });
    take.canvas = q('canvas');
    ui.takes.append(el);
  }
  drawTakes();
}

/** Draw each take's waveform on the song timeline, with the playhead. */
function drawTakes(playhead = null) {
  const length = songLength();
  const css = getComputedStyle(document.body);
  const color = (name) => css.getPropertyValue(name).trim();
  const dpr = window.devicePixelRatio || 1;
  for (const take of state.takes) {
    const canvas = take.canvas;
    if (!canvas) continue;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    if (length <= 0) continue;
    const x = (t) => TIMELINE_PAD + (t / length) * (width - TIMELINE_PAD - TIMELINE_RIGHT);

    if (state.arrangement) {
      g.strokeStyle = color('--grid');
      const beat = 60 / state.arrangement.bpm;
      for (let t = 0; t <= length; t += beat) {
        g.beginPath();
        g.moveTo(x(t), 0);
        g.lineTo(x(t), height);
        g.stroke();
      }
    }

    const x0 = x(takeStart(take));
    const x1 = x(takeEnd(take));
    const buckets = Math.max(1, Math.round(x1 - x0));
    const peaks = takePeaks(take.samples, buckets);
    let max = 1e-6;
    for (const p of peaks) max = Math.max(max, p);
    g.fillStyle = color('--take');
    const mid = height / 2;
    for (let i = 0; i < buckets; i++) {
      const h = Math.max(1, (peaks[i] / max) * (height / 2 - 3));
      g.fillRect(x0 + i, mid - h, 1, h * 2);
    }

    if (playhead !== null && playhead >= 0) {
      g.strokeStyle = color('--accent');
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x(playhead), 0);
      g.lineTo(x(playhead), height);
      g.stroke();
      g.lineWidth = 1;
    }
  }
}

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
  const length = songLength();
  const pad = TIMELINE_PAD;
  const x = (t) => pad + (t / length) * (width - pad - TIMELINE_RIGHT);
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

window.addEventListener('resize', () => { drawRoll(); drawTakes(); });
drawRoll();
