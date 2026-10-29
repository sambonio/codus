import { detectPitchTrack, downsample } from './pitch.js';
import { segmentNotes, quantizeNotes, midiToName } from './notes.js';
import { playParts } from './synth.js';
import { getInstrument, instrumentGroups, loadInstrument } from './instruments/index.js';
import { buildSong, songLength, addExtraTrack, setTrackPart, audibleGain } from './song.js';
import { buildTimeline, createSection, moveInOrder, removeSection } from './arrangement.js';
import { PART_TYPES } from './parts.js';
import { buildFromDescription, SUGGESTIONS } from './builder.js';
import { writeMidi } from './midi.js';
import { buildGarageBandPack, download } from './export.js';

const $ = (id) => document.getElementById(id);
const ui = {
  record: $('record'), file: $('file'), timer: $('timer'), meter: $('meter'),
  bassMode: $('bassMode'), keysMode: $('keysMode'), quantize: $('quantize'),
  bpm: $('bpm'), transpose: $('transpose'), summary: $('summary'), roll: $('roll'),
  play: $('play'), stop: $('stop'), loop: $('loop'), midi: $('midi'),
  garageband: $('garageband'), exportStatus: $('exportStatus'),
  tracks: $('tracks'), playVoice: $('playVoice'), timeline: $('timeline'),
  sections: $('sections'), sectionName: $('sectionName'), deleteSection: $('deleteSection'),
  order: $('order'), addToOrder: $('addToOrder'),
  builderForm: $('builderForm'), builderText: $('builderText'), builderSuggestions: $('builderSuggestions'), builderStatus: $('builderStatus'),
};

let audioCtx = null;
const state = {
  // Hummed sections: { id, name, recording (AudioBuffer), raw (notes as
  // sung, recording time), origin, melody (arranged, from 0) }.
  sections: [],
  order: [],       // section ids, first to last; repeats allowed
  selected: null,  // the section Record captures into
  song: null,      // see src/song.js
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
  const notes = segmentNotes(track);
  let section = selectedSection();
  if (!section) {
    section = createSection(state.sections, []);
    state.sections.push(section);
    state.selected = section.id;
  }
  section.recording = audio;
  section.raw = notes;
  if (notes.length && !state.order.includes(section.id)) state.order.push(section.id);
  renderSections();
  rebuild();
  if (!notes.length) ui.summary.textContent = `Didn't catch any notes in the ${section.name}. Try humming a bit louder and closer to the mic.`;
  preloadInstruments();
}

// ---------- Sections ----------

function selectedSection() {
  return state.sections.find((s) => s.id === state.selected) ?? null;
}

function hasNotes(section) {
  return section.raw?.length > 0;
}

function renderSections() {
  ui.sections.replaceChildren();
  for (const section of state.sections) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = hasNotes(section) ? 'chip' : 'chip empty';
    chip.textContent = hasNotes(section) ? section.name : `${section.name} (not recorded)`;
    chip.setAttribute('aria-pressed', String(section.id === state.selected));
    chip.addEventListener('click', () => {
      state.selected = section.id;
      renderSections();
    });
    ui.sections.append(chip);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'chip';
  add.textContent = '+ New section';
  add.addEventListener('click', () => {
    // Fill the empty section first rather than piling up empty ones.
    const empty = state.sections.find((s) => !hasNotes(s));
    const section = empty ?? createSection(state.sections, []);
    if (!empty) state.sections.push(section);
    state.selected = section.id;
    renderSections();
  });
  if (state.sections.length) ui.sections.append(add);

  const section = selectedSection();
  if (!recorder) ui.record.textContent = `● ${section && hasNotes(section) ? 'Re-record' : 'Record'} ${section?.name ?? 'Verse'}`;
  ui.sectionName.disabled = !section;
  ui.sectionName.value = section?.name ?? '';
  ui.deleteSection.disabled = !section;
  renderOrder();
}

function renderOrder() {
  const byId = new Map(state.sections.map((s) => [s.id, s]));
  ui.order.replaceChildren();
  state.order.forEach((id, i) => {
    const item = document.createElement('li');
    item.className = 'block';
    item.append(byId.get(id)?.name ?? '?');
    const button = (text, label, onClick, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.disabled = disabled;
      b.addEventListener('click', onClick);
      item.append(b);
    };
    const name = byId.get(id)?.name;
    button('←', `Move ${name} earlier`, () => setOrder(moveInOrder(state.order, i, i - 1)), i === 0);
    button('→', `Move ${name} later`, () => setOrder(moveInOrder(state.order, i, i + 1)), i === state.order.length - 1);
    button('✕', `Take this ${name} out of the song`, () => setOrder(state.order.filter((_, j) => j !== i)));
    ui.order.append(item);
  });

  ui.addToOrder.replaceChildren(new Option('+ Add a section…', ''));
  for (const section of state.sections.filter(hasNotes)) ui.addToOrder.add(new Option(section.name, section.id));
  ui.addToOrder.disabled = !state.sections.some(hasNotes);
}

function setOrder(order) {
  state.order = order;
  renderOrder();
  rebuild();
}

ui.addToOrder.addEventListener('change', () => {
  if (ui.addToOrder.value) setOrder([...state.order, ui.addToOrder.value]);
});

ui.sectionName.addEventListener('change', () => {
  const section = selectedSection();
  const name = ui.sectionName.value.trim();
  if (!section || !name) return;
  section.name = name;
  renderSections();
  rebuild();
});

ui.deleteSection.addEventListener('click', () => {
  const section = selectedSection();
  if (!section) return;
  if (hasNotes(section) && !confirm(`Delete the ${section.name} and its recording?`)) return;
  ({ sections: state.sections, order: state.order } = removeSection(state.sections, state.order, section.id));
  state.selected = state.sections[0]?.id ?? null;
  renderSections();
  rebuild();
});

function rebuild() {
  stopPlayback();
  const recorded = state.sections.filter(hasNotes);
  const bpm = clampBpm();
  const transpose = Number(ui.transpose.value) || 0;
  for (const section of recorded) {
    section.origin = section.raw[0].start;
    let melody = section.raw.map((n) => ({ ...n, midi: n.midi + transpose, start: n.start - section.origin }));
    if (ui.quantize.checked) melody = quantizeNotes(melody, { bpm, division: 2 });
    section.melody = melody;
  }
  const timeline = recorded.length
    ? buildTimeline(recorded, state.order, { bpm, bassMode: ui.bassMode.value, keysMode: ui.keysMode.value })
    : null;

  if (!timeline?.markers.length) {
    state.song = null;
    renderTracks();
    ui.summary.textContent = recorded.length
      ? 'Add a section to the song order to hear it.'
      : 'Record something to get started.';
    setPlayable(false);
    drawRoll();
    drawTimeline();
    return;
  }

  const { key, melody, parts, markers } = timeline;
  state.song = buildSong({ melody, key, bpm, origin: 0, parts, markers }, state.song?.tracks);
  renderTracks();

  const range = `${midiToName(Math.min(...melody.map((n) => n.midi)))}–${midiToName(Math.max(...melody.map((n) => n.midi)))}`;
  const bars = Math.round(markers[markers.length - 1].end / ((4 * 60) / bpm));
  const sections = markers.length === 1 ? '1 section' : `${markers.length} sections`;
  ui.summary.textContent = `${sections}, ${bars} bars, range ${range}, sounds like ${key.name}.`;
  setPlayable(true);
  drawRoll();
  drawTimeline();
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

// ---------- Tracks ----------

function renderTracks() {
  ui.tracks.replaceChildren();
  for (const track of state.song?.tracks ?? []) {
    const row = document.createElement('div');
    row.className = 'track';

    const name = document.createElement('span');
    name.className = 'track-name';
    name.textContent = track.name;

    const select = document.createElement('select');
    select.setAttribute('aria-label', `${track.name} instrument`);
    for (const [label, list] of instrumentGroups(track.role)) {
      const group = document.createElement('optgroup');
      group.label = label;
      for (const inst of list) group.append(new Option(inst.name, inst.id, false, inst.id === track.instrument));
      select.append(group);
    }
    // Extra settings some instruments offer, like the organ's Leslie speed.
    const controls = document.createElement('span');
    controls.className = 'track-controls';
    const showControls = async () => {
      controls.replaceChildren();
      let instrument;
      try {
        instrument = await loadInstrument(getCtx(), track.instrument);
      } catch {
        return;
      }
      if (select.value !== track.instrument) return; // changed while loading
      for (const control of instrument.controls ?? []) {
        const label = document.createElement('label');
        const picker = document.createElement('select');
        for (const [value, text] of control.options) picker.add(new Option(text, value, false, instrument[control.id] === value));
        picker.addEventListener('change', () => { instrument[control.id] = picker.value; });
        label.append(`${control.label} `, picker);
        controls.append(label);
      }
    };
    select.addEventListener('change', () => {
      track.instrument = select.value;
      if (track.role === 'extra') {
        track.name = getInstrument(track.instrument).name.replace(/ \(.*\)/, '');
        name.textContent = track.name;
      }
      showControls();
      loadInstrument(getCtx(), track.instrument).then((inst) => inst.prepare?.(track.notes)).catch(() => {});
    });

    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1.5';
    volume.step = '0.05';
    volume.value = String(track.volume);
    volume.setAttribute('aria-label', `${track.name} volume`);
    volume.addEventListener('input', () => {
      track.volume = Number(volume.value);
      applyMix();
    });

    const pan = document.createElement('label');
    pan.className = 'pan';
    const panRange = document.createElement('input');
    panRange.type = 'range';
    panRange.className = 'pan-range';
    panRange.min = '-1';
    panRange.max = '1';
    panRange.step = '0.1';
    panRange.value = String(track.pan ?? 0);
    panRange.setAttribute('aria-label', `${track.name} pan, left to right`);
    panRange.addEventListener('input', () => {
      track.pan = Number(panRange.value);
      state.playback?.handle.setPan(track.id, track.pan);
    });
    // Double-click puts it back in the middle.
    panRange.addEventListener('dblclick', () => {
      panRange.value = '0';
      panRange.dispatchEvent(new Event('input'));
    });
    pan.append('L', panRange, 'R');

    const mute = document.createElement('label');
    const muteBox = document.createElement('input');
    muteBox.type = 'checkbox';
    muteBox.checked = track.muted;
    muteBox.addEventListener('change', () => {
      track.muted = muteBox.checked;
      applyMix();
    });
    mute.append(muteBox, ' Mute');

    const solo = document.createElement('label');
    const soloBox = document.createElement('input');
    soloBox.type = 'checkbox';
    soloBox.checked = !!track.solo;
    soloBox.addEventListener('change', () => {
      track.solo = soloBox.checked;
      applyMix();
    });
    solo.append(soloBox, ' Solo');

    row.append(name, select, controls);
    if (track.role === 'extra') {
      const part = document.createElement('select');
      part.setAttribute('aria-label', `${track.name} part`);
      for (const [value, text] of Object.entries(PART_TYPES)) part.add(new Option(text, value, false, value === track.part));
      part.addEventListener('change', () => {
        stopPlayback();
        setTrackPart(state.song, track, part.value);
        drawRoll();
        drawTimeline();
      });
      row.append(part);
    }
    const level = document.createElement('label');
    level.className = 'pan';
    level.append('Level', volume);
    row.append(level, pan, mute, solo);
    if (track.role === 'extra') {
      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.textContent = '✕';
      remove.title = `Remove ${track.name}`;
      remove.setAttribute('aria-label', `Remove ${track.name}`);
      remove.addEventListener('click', () => {
        stopPlayback();
        state.song.tracks = state.song.tracks.filter((t) => t !== track);
        renderTracks();
        drawRoll();
        drawTimeline();
      });
      row.append(remove);
    }
    showControls();
    ui.tracks.append(row);
  }
}

// Apply volume, mute and solo to every track, live.
function applyMix() {
  const tracks = state.song?.tracks ?? [];
  for (const track of tracks) state.playback?.handle.setGain(track.id, audibleGain(track, tracks));
  drawRoll(state.playback ? audioCtx.currentTime - state.playback.startTime : null);
  drawTimeline();
}

// ---------- Instrument builder ----------

function addFromDescription(text) {
  if (!state.song) {
    ui.builderStatus.textContent = 'Hum a melody first, then add instruments to it.';
    return;
  }
  const built = buildFromDescription(text);
  if (!built) {
    ui.builderStatus.textContent = `Couldn't work out an instrument from "${text}". Try naming one, like "cello" or "brass stabs".`;
    return;
  }
  stopPlayback();
  const track = addExtraTrack(state.song, built);
  ui.builderStatus.textContent = `Added ${track.name} playing ${PART_TYPES[track.part].toLowerCase()}.`;
  ui.builderText.value = '';
  renderTracks();
  drawRoll();
  drawTimeline();
  loadInstrument(getCtx(), track.instrument).then((inst) => inst.prepare?.(track.notes)).catch(() => {});
}

ui.builderForm.addEventListener('submit', (e) => {
  e.preventDefault();
  addFromDescription(ui.builderText.value);
});
for (const suggestion of SUGGESTIONS) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = suggestion;
  chip.addEventListener('click', () => addFromDescription(suggestion));
  ui.builderSuggestions.append(chip);
}

// Start fetching samples early so Play is instant.
function preloadInstruments() {
  for (const track of state.song?.tracks ?? []) {
    loadInstrument(getCtx(), track.instrument).then((inst) => inst.prepare?.(track.notes)).catch(() => {});
  }
}

// ---------- Playback ----------

let playRequest = 0;

async function startPlayback() {
  const song = state.song;
  if (!song) return;
  stopPlayback();
  const ctx = getCtx();
  const request = ++playRequest;

  ui.play.textContent = '… Loading';
  const failed = [];
  const parts = await Promise.all(song.tracks.map(async (track) => {
    let instrument;
    try {
      instrument = await loadInstrument(ctx, track.instrument);
      await instrument.prepare?.(track.notes);
    } catch (err) {
      failed.push(`${getInstrument(track.instrument)?.name ?? track.instrument} (${err.message})`);
      return null;
    }
    return {
      id: track.id, notes: track.notes, play: instrument.play, release: instrument.release,
      gain: audibleGain(track, song.tracks), pan: track.pan ?? 0, reverb: instrument.reverb ?? 0,
    };
  }));
  ui.play.textContent = '▶ Play';
  if (failed.length) ui.summary.textContent = `Couldn't load ${failed.join(', ')}. Check your connection and press Play again.`;
  // Another play or stop happened while loading.
  if (request !== playRequest || state.playback) return;

  const handle = playParts(ctx, parts.filter(Boolean));

  // The original humming, section by section, under the band.
  const voices = [];
  if (ui.playVoice.checked) {
    const byId = new Map(state.sections.map((s) => [s.id, s]));
    for (const marker of song.markers) {
      const section = byId.get(marker.sectionId);
      if (!section?.recording) continue;
      const voice = ctx.createBufferSource();
      voice.buffer = section.recording;
      voice.connect(ctx.destination);
      voice.start(handle.startTime + marker.start, section.origin, marker.end - marker.start);
      voices.push(voice);
    }
  }

  const length = songLength(song) + 0.4;
  state.playback = { handle, voices, startTime: handle.startTime, length };
  ui.stop.disabled = false;
  animatePlayhead();
}

function stopPlayback() {
  playRequest++;
  const p = state.playback;
  if (!p) return;
  p.handle.stop();
  for (const voice of p.voices) try { voice.stop(); } catch { /* already stopped */ }
  state.playback = null;
  ui.stop.disabled = true;
  drawRoll();
  drawTimeline();
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
  drawTimeline(Math.max(0, elapsed));
  requestAnimationFrame(animatePlayhead);
}

ui.play.addEventListener('click', startPlayback);
ui.stop.addEventListener('click', stopPlayback);

// ---------- Export ----------

/**
 * Every part of the song in the shape export.js takes: the melody (MIDI
 * only), each instrument track, and the hummed voice section by section.
 * With `sound`, instruments are loaded so the parts can be rendered to audio.
 */
async function exportTracks(song, { sound = false } = {}) {
  const ctx = getCtx();
  const tracks = [{ name: 'Melody', notes: song.melody, program: 0, stem: false }];
  for (const track of song.tracks) {
    const entry = { name: track.name, notes: track.notes, program: getInstrument(track.instrument)?.gmProgram ?? 0 };
    if (sound) {
      const instrument = await loadInstrument(ctx, track.instrument);
      await instrument.prepare?.(track.notes);
      Object.assign(entry, {
        play: instrument.play, release: instrument.release, reverb: instrument.reverb ?? 0,
        volume: track.volume, pan: track.pan ?? 0, mixGain: audibleGain(track, song.tracks),
      });
    }
    tracks.push(entry);
  }
  const byId = new Map(state.sections.map((s) => [s.id, s]));
  const clips = song.markers
    .map((m) => ({ marker: m, section: byId.get(m.sectionId) }))
    .filter(({ section }) => section?.recording)
    .map(({ marker, section }) => ({
      buffer: section.recording, offset: section.origin, at: marker.start, duration: marker.end - marker.start,
    }));
  if (clips.length) tracks.push({ name: 'Voice', clips, mixGain: ui.playVoice.checked ? 1 : 0 });
  return tracks;
}

const markersFor = (song) => song.markers.map((m) => ({ name: m.name, start: m.start, end: m.end }));

ui.midi.addEventListener('click', async () => {
  const song = state.song;
  if (!song) return;
  const tracks = await exportTracks(song);
  download(writeMidi(tracks, { bpm: song.bpm, markers: markersFor(song) }), 'hummagroove.mid', 'audio/midi');
});

ui.garageband.addEventListener('click', async () => {
  const song = state.song;
  if (!song) return;
  ui.garageband.disabled = true;
  const status = (text) => (ui.exportStatus.textContent = text);
  try {
    status('Loading instruments…');
    const tracks = await exportTracks(song, { sound: true });
    const zip = await buildGarageBandPack({
      title: 'Hummagroove', bpm: song.bpm, tracks, markers: markersFor(song),
      sampleRate: getCtx().sampleRate, onProgress: status,
    });
    download(zip, 'hummagroove-garageband.zip', 'application/zip');
    status('Done. Unzip it and drag the files into GarageBand at bar 1.');
  } catch (err) {
    status(`Export failed: ${err.message}`);
  } finally {
    ui.garageband.disabled = !state.song;
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

  const song = state.song;
  if (!song) return;

  const all = [...song.melody, ...song.tracks.flatMap((t) => t.notes)];
  const low = Math.min(...all.map((n) => n.midi)) - 1;
  const high = Math.max(...all.map((n) => n.midi)) + 1;
  const length = songLength(song);
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
  const beat = 60 / song.bpm;
  for (let t = 0; t <= length; t += beat) {
    g.beginPath();
    g.moveTo(x(t), 0);
    g.lineTo(x(t), height);
    g.stroke();
  }

  // Section boundaries and names.
  g.fillStyle = color('--muted');
  for (const marker of song.markers ?? []) {
    g.strokeStyle = color('--muted');
    g.beginPath();
    g.moveTo(x(marker.start), 0);
    g.lineTo(x(marker.start), height);
    g.stroke();
    g.fillText(marker.name, x(marker.start) + 4, 12);
  }

  const drawNotes = (notes, fill, alpha) => {
    g.globalAlpha = alpha;
    g.fillStyle = fill;
    for (const n of notes) {
      g.fillRect(x(n.start), y(n.midi) + 1, Math.max(2, x(n.start + n.duration) - x(n.start) - 1), Math.max(2, rowH - 2));
    }
    g.globalAlpha = 1;
  };
  for (const track of song.tracks) {
    if (audibleGain(track, song.tracks)) drawNotes(track.notes, color(`--${track.id}`) || color('--extra'), track.id === 'bass' ? 0.9 : 0.7);
  }
  drawNotes(song.melody, color('--melody'), 0.35);

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

// ---------- Timeline: one lane per instrument ----------

function drawTimeline(playhead = null) {
  const canvas = ui.timeline;
  const song = state.song;
  const lanes = song ? [{ name: 'Your melody', notes: song.melody, fill: '--melody', on: true },
    ...song.tracks.map((t) => ({ name: t.name, notes: t.notes, fill: t.role === 'extra' ? '--extra' : `--${t.id}`, on: audibleGain(t, song.tracks) > 0 }))] : [];
  canvas.hidden = !song;
  if (!song) return;
  const header = 20;
  const laneH = 34;
  canvas.style.height = `${header + lanes.length * laneH}px`;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = header + lanes.length * laneH;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  const css = getComputedStyle(document.body);
  const color = (name) => css.getPropertyValue(name).trim();

  const label = Math.min(110, width * 0.25);
  const length = songLength(song);
  const x = (t) => label + (t / length) * (width - label - 4);
  g.font = '11px system-ui';
  g.textBaseline = 'middle';

  // Section ruler, shaded alternately.
  (song.markers ?? []).forEach((marker, i) => {
    g.fillStyle = color('--grid');
    if (i % 2 === 0) g.fillRect(x(marker.start), 0, x(marker.end) - x(marker.start), height);
    g.fillStyle = color('--text');
    g.fillText(marker.name, x(marker.start) + 4, header / 2, x(marker.end) - x(marker.start) - 6);
  });

  lanes.forEach((lane, i) => {
    const top = header + i * laneH;
    g.strokeStyle = color('--border');
    g.beginPath();
    g.moveTo(0, top);
    g.lineTo(width, top);
    g.stroke();
    g.fillStyle = lane.on ? color('--text') : color('--muted');
    g.fillText(lane.name, 6, top + laneH / 2, label - 10);
    if (!lane.notes.length) return;
    // Each lane is a tiny piano roll scaled to its own range.
    const low = Math.min(...lane.notes.map((n) => n.midi));
    const high = Math.max(...lane.notes.map((n) => n.midi));
    // At least an octave tall, so a narrow line sits in the middle.
    const span = Math.max(12, high - low);
    const highest = (high + low) / 2 + span / 2;
    const noteH = Math.max(2, (laneH - 8) / (span + 1));
    g.globalAlpha = lane.on ? 0.85 : 0.2;
    g.fillStyle = color(lane.fill) || color('--extra');
    for (const n of lane.notes) {
      const y = top + 4 + ((highest - n.midi) / span) * (laneH - 8 - noteH);
      g.fillRect(x(n.start), y, Math.max(1.5, x(n.start + n.duration) - x(n.start) - 0.5), noteH);
    }
    g.globalAlpha = 1;
  });

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

window.addEventListener('resize', () => {
  drawRoll();
  drawTimeline();
});
renderSections();
drawRoll();
drawTimeline();
