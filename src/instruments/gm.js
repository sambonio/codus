// The General MIDI library: 128 instruments rendered from the Musyng Kite
// soundfont, one MP3 per semitone, fetched on demand from
// github.com/gleitz/midi-js-soundfonts (CC BY-SA 3.0).

const BASE = 'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/MusyngKite/';
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// [id, display name, family] in General MIDI program order.
export const GM_INSTRUMENTS = [
  ['acoustic_grand_piano', 'Grand piano', 'Piano'], ['bright_acoustic_piano', 'Bright piano', 'Piano'],
  ['electric_grand_piano', 'Electric grand', 'Piano'], ['honkytonk_piano', 'Honky-tonk piano', 'Piano'],
  ['electric_piano_1', 'Rhodes piano', 'Piano'], ['electric_piano_2', 'FM electric piano', 'Piano'],
  ['harpsichord', 'Harpsichord', 'Piano'], ['clavinet', 'Clavinet', 'Piano'],
  ['celesta', 'Celesta', 'Mallets & bells'], ['glockenspiel', 'Glockenspiel', 'Mallets & bells'],
  ['music_box', 'Music box', 'Mallets & bells'], ['vibraphone', 'Vibraphone', 'Mallets & bells'],
  ['marimba', 'Marimba', 'Mallets & bells'], ['xylophone', 'Xylophone', 'Mallets & bells'],
  ['tubular_bells', 'Tubular bells', 'Mallets & bells'], ['dulcimer', 'Dulcimer', 'Mallets & bells'],
  ['drawbar_organ', 'Drawbar organ (GM)', 'Organ'], ['percussive_organ', 'Percussive organ (GM)', 'Organ'],
  ['rock_organ', 'Rock organ (GM)', 'Organ'], ['church_organ', 'Church organ', 'Organ'],
  ['reed_organ', 'Reed organ', 'Organ'], ['accordion', 'Accordion', 'Organ'],
  ['harmonica', 'Harmonica', 'Organ'], ['tango_accordion', 'Tango accordion', 'Organ'],
  ['acoustic_guitar_nylon', 'Nylon guitar', 'Guitar'], ['acoustic_guitar_steel', 'Steel guitar', 'Guitar'],
  ['electric_guitar_jazz', 'Jazz guitar', 'Guitar'], ['electric_guitar_clean', 'Clean electric guitar', 'Guitar'],
  ['electric_guitar_muted', 'Muted guitar', 'Guitar'], ['overdriven_guitar', 'Overdriven guitar', 'Guitar'],
  ['distortion_guitar', 'Distortion guitar', 'Guitar'], ['guitar_harmonics', 'Guitar harmonics', 'Guitar'],
  ['acoustic_bass', 'Acoustic bass (GM)', 'Bass'], ['electric_bass_finger', 'Finger bass (GM)', 'Bass'],
  ['electric_bass_pick', 'Pick bass', 'Bass'], ['fretless_bass', 'Fretless bass', 'Bass'],
  ['slap_bass_1', 'Slap bass', 'Bass'], ['slap_bass_2', 'Slap bass 2', 'Bass'],
  ['synth_bass_1', 'Synth bass 1', 'Bass'], ['synth_bass_2', 'Synth bass 2', 'Bass'],
  ['violin', 'Violin', 'Strings'], ['viola', 'Viola', 'Strings'], ['cello', 'Cello', 'Strings'],
  ['contrabass', 'Contrabass', 'Strings'], ['tremolo_strings', 'Tremolo strings', 'Strings'],
  ['pizzicato_strings', 'Pizzicato strings', 'Strings'], ['orchestral_harp', 'Harp', 'Strings'],
  ['timpani', 'Timpani', 'Strings'], ['string_ensemble_1', 'String ensemble', 'Strings'],
  ['string_ensemble_2', 'Slow strings', 'Strings'], ['synth_strings_1', 'Synth strings', 'Strings'],
  ['synth_strings_2', 'Synth strings 2', 'Strings'], ['choir_aahs', 'Choir aahs', 'Voices'],
  ['voice_oohs', 'Voice oohs', 'Voices'], ['synth_choir', 'Synth choir', 'Voices'],
  ['orchestra_hit', 'Orchestra hit', 'Strings'], ['trumpet', 'Trumpet', 'Brass'], ['trombone', 'Trombone', 'Brass'],
  ['tuba', 'Tuba', 'Brass'], ['muted_trumpet', 'Muted trumpet', 'Brass'], ['french_horn', 'French horn', 'Brass'],
  ['brass_section', 'Brass section', 'Brass'], ['synth_brass_1', 'Synth brass', 'Brass'],
  ['synth_brass_2', 'Synth brass 2', 'Brass'], ['soprano_sax', 'Soprano sax', 'Reeds'],
  ['alto_sax', 'Alto sax', 'Reeds'], ['tenor_sax', 'Tenor sax', 'Reeds'], ['baritone_sax', 'Baritone sax', 'Reeds'],
  ['oboe', 'Oboe', 'Reeds'], ['english_horn', 'English horn', 'Reeds'], ['bassoon', 'Bassoon', 'Reeds'],
  ['clarinet', 'Clarinet', 'Reeds'], ['piccolo', 'Piccolo', 'Flutes'], ['flute', 'Flute', 'Flutes'],
  ['recorder', 'Recorder', 'Flutes'], ['pan_flute', 'Pan flute', 'Flutes'], ['blown_bottle', 'Blown bottle', 'Flutes'],
  ['shakuhachi', 'Shakuhachi', 'Flutes'], ['whistle', 'Whistle', 'Flutes'], ['ocarina', 'Ocarina', 'Flutes'],
  ['lead_1_square', 'Square lead', 'Synth'], ['lead_2_sawtooth', 'Saw lead', 'Synth'],
  ['lead_3_calliope', 'Calliope lead', 'Synth'], ['lead_4_chiff', 'Chiff lead', 'Synth'],
  ['lead_5_charang', 'Charang lead', 'Synth'], ['lead_6_voice', 'Voice lead', 'Synth'],
  ['lead_7_fifths', 'Fifths lead', 'Synth'], ['lead_8_bass__lead', 'Bass + lead', 'Synth'],
  ['pad_1_new_age', 'New age pad', 'Synth'], ['pad_2_warm', 'Warm pad', 'Synth'],
  ['pad_3_polysynth', 'Polysynth pad', 'Synth'], ['pad_4_choir', 'Choir pad', 'Synth'],
  ['pad_5_bowed', 'Bowed pad', 'Synth'], ['pad_6_metallic', 'Metallic pad', 'Synth'],
  ['pad_7_halo', 'Halo pad', 'Synth'], ['pad_8_sweep', 'Sweep pad', 'Synth'],
  ['fx_1_rain', 'Rain FX', 'Effects'], ['fx_2_soundtrack', 'Soundtrack FX', 'Effects'],
  ['fx_3_crystal', 'Crystal FX', 'Effects'], ['fx_4_atmosphere', 'Atmosphere FX', 'Effects'],
  ['fx_5_brightness', 'Brightness FX', 'Effects'], ['fx_6_goblins', 'Goblins FX', 'Effects'],
  ['fx_7_echoes', 'Echoes FX', 'Effects'], ['fx_8_scifi', 'Sci-fi FX', 'Effects'],
  ['sitar', 'Sitar', 'World'], ['banjo', 'Banjo', 'World'], ['shamisen', 'Shamisen', 'World'],
  ['koto', 'Koto', 'World'], ['kalimba', 'Kalimba', 'World'], ['bagpipe', 'Bagpipe', 'World'],
  ['fiddle', 'Fiddle', 'World'], ['shanai', 'Shanai', 'World'], ['tinkle_bell', 'Tinkle bell', 'Mallets & bells'],
  ['agogo', 'Agogo', 'Percussion'], ['steel_drums', 'Steel drums', 'Percussion'], ['woodblock', 'Woodblock', 'Percussion'],
  ['taiko_drum', 'Taiko drum', 'Percussion'], ['melodic_tom', 'Melodic tom', 'Percussion'],
  ['synth_drum', 'Synth drum', 'Percussion'], ['reverse_cymbal', 'Reverse cymbal', 'Effects'],
  ['guitar_fret_noise', 'Guitar fret noise', 'Effects'], ['breath_noise', 'Breath noise', 'Effects'],
  ['seashore', 'Seashore', 'Effects'], ['bird_tweet', 'Bird tweet', 'Effects'],
  ['telephone_ring', 'Telephone ring', 'Effects'], ['helicopter', 'Helicopter', 'Effects'],
  ['applause', 'Applause', 'Effects'], ['gunshot', 'Gunshot', 'Effects'],
];

export function gmNoteName(midi) {
  return NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

// Sustained families get crossfaded loops so long notes don't run out.
const SUSTAINED = new Set(['Organ', 'Strings', 'Voices', 'Brass', 'Reeds', 'Flutes', 'Synth']);

/** Load a GM instrument by soundfont id. Samples are fetched per note in prepare(). */
export function createGmInstrument(ctx, soundfontId, displayName, family) {
  const buffers = new Map(); // midi -> Promise<{ buffer, offset }>
  const sustained = SUSTAINED.has(family) && !/pizzicato|harp|timpani|hit/.test(soundfontId);

  const fetchNote = (midi) => {
    if (!buffers.has(midi)) {
      const promise = fetch(`${BASE}${soundfontId}-mp3/${gmNoteName(midi)}.mp3`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => ({ buffer, offset: onsetOf(buffer) }));
      promise.catch(() => buffers.delete(midi));
      buffers.set(midi, promise);
    }
    return buffers.get(midi);
  };
  const ready = new Map();

  return {
    name: displayName,
    credit: 'Musyng Kite soundfont via gleitz/midi-js-soundfonts (CC BY-SA 3.0)',
    reverb: sustained ? 0.18 : 0.12,
    /** Fetch the samples these notes need. Call before play(). */
    async prepare(notes) {
      const needed = [...new Set(notes.map((n) => clampMidi(n.midi)))];
      await Promise.all(needed.map(async (midi) => ready.set(midi, await fetchNote(midi))));
    },
    play(ctx, out, { midi, start, duration, velocity = 0.8 }) {
      const sample = ready.get(clampMidi(midi));
      if (!sample) return;
      const end = start + Math.max(0.05, duration);
      const level = 0.25 + 0.75 * velocity;
      const release = sustained ? 0.12 : 0.06;
      const { buffer, offset } = sample;
      const usable = buffer.duration - offset;

      const voice = (from, at, until, fadeIn, fadeOut) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const g = ctx.createGain();
        if (fadeIn) {
          g.gain.setValueAtTime(0, at);
          g.gain.linearRampToValueAtTime(level, at + fadeIn);
        } else {
          g.gain.setValueAtTime(level, at);
        }
        if (fadeOut) {
          g.gain.setValueAtTime(level, until - fadeOut);
          g.gain.linearRampToValueAtTime(0, until);
        }
        src.connect(g).connect(out);
        src.start(at, from);
        return { src, g };
      };

      if (!sustained || duration + 0.2 < usable) {
        const { src, g } = voice(offset, start, null, 0, 0);
        g.gain.setTargetAtTime(0, end, release);
        src.stop(end + release * 8);
        return;
      }
      // Long sustained note: chain segments of the sample's steady part with crossfades.
      const loopFrom = offset + Math.min(0.8, usable * 0.3);
      const fade = 0.3;
      let at = start;
      let from = offset;
      let first = true;
      while (at < end) {
        const segment = buffer.duration - from - 0.1;
        if (segment <= fade * 2) break;
        const until = Math.min(at + segment, end + fade);
        const last = until >= end;
        const { src, g } = voice(from, at, last ? null : until, first ? 0 : fade, last ? 0 : fade);
        if (last) g.gain.setTargetAtTime(0, end, release);
        src.stop(last ? end + release * 8 : until);
        at = until - fade;
        from = loopFrom;
        first = false;
      }
    },
  };
}

function clampMidi(midi) {
  return Math.max(21, Math.min(108, Math.round(midi)));
}

function onsetOf(buffer) {
  const data = buffer.getChannelData(0);
  let peak = 1e-6;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  let i = 0;
  while (i < data.length && Math.abs(data[i]) < peak * 0.01) i++;
  return Math.max(0, i - Math.floor(buffer.sampleRate * 0.0015)) / buffer.sampleRate;
}
