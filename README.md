# Hummagroove

Hum or sing a melody into your microphone and hear it played back as a bass line and keyboard part.

Everything runs in the browser with the Web Audio API. There is no build step and no dependencies.

## Run it

Microphone access needs a secure origin, so serve the folder over `localhost`:

```sh
npm start            # serves on http://localhost:8080
# or: python3 -m http.server 8080
```

Open the page, press **Record**, hum, press **Stop recording**, then **Play**.
You can also open an existing audio file instead of recording.

## How it works

1. **Capture** (`src/app.js`): the mic is recorded with `MediaRecorder`, decoded, mixed to mono and downsampled to 16 kHz.
2. **Pitch detection** (`src/pitch.js`): the YIN algorithm estimates the pitch of each 64 ms frame (16 ms hop). Quiet frames are gated out relative to the loudest part of the take.
3. **Notes** (`src/notes.js`): pitches are median-smoothed, corrected for the singer's overall tuning offset (most people aren't at A440), rounded to semitones and grouped into notes. Very short blips and glides are absorbed. Notes can optionally be snapped to an eighth-note grid at a chosen tempo.
4. **Arrangement** (`src/notes.js`): the key is estimated with Krumhansl-Kessler profiles. The bass either follows the melody an octave or two down, or plays the root of a diatonic chord chosen to fit each melody note. The keys play the melody, optionally on top of that chord.
5. **Tracks and instruments** (`src/song.js`, `src/instruments/`): the song is the melody plus a list of tracks, each with an instrument, volume, pan, mute and solo. The bass instruments are real multi-sampled recordings (an electric and an upright bass with velocity layers and round robins) plus a synth bass. The keys default to a modelled Hammond organ (`src/instruments/organ.js`) with drawbar presets, key click, percussion, chorus, overdrive and a Leslie speaker with slow/fast. Every mix goes through a room reverb, bus compression and a limiter.
6. **Instrument builder** (`src/builder.js`, `src/parts.js`): describe an instrument ("warm strings pad", "funky clavinet") and it adds a track that plays sustained chords, arpeggios, rhythmic stabs, a harmony line or the melody, following the chords of your tune. Any of the 128 General MIDI instruments (`src/instruments/gm.js`, fetched per note on demand) can be picked for any track.
7. **Song sections and mix** (`src/arrangement.js`): hum each part of the song (verse, chorus, bridge...) as its own section and put them in any order, with repeats. One key is detected across the whole song and every section starts on a bar line. The mix view shows a lane per instrument, with level, pan, mute and solo for each track.
8. **Export to GarageBand** (`src/export.js`, `src/midi.js`): sketch the song here, mix it in GarageBand. **GarageBand pack** downloads a zip with a MIDI file (melody plus one track per instrument, GM programs, tempo, 4/4 and the song's sections as markers), a 24-bit WAV stem of every track rendered offline with the same instruments, level, pan and reverb you hear (without the mix bus, so it can be mixed afresh), the hummed voice as its own stem, the full mix as you hear it, and a how-to for GarageBand on Mac and iOS listing which bar each section starts on. Every file starts at bar 1 and is padded to whole bars. **MIDI only** downloads just the .mid. Anything new that makes sound gets exported by adding it to `exportTracks()` in `src/app.js` (see the track shape at the top of the song layout section of `src/export.js`).

## Tests

```sh
npm test
```

The tests synthesise hummed melodies (harmonics, vibrato, detuning, noise) and check that the pipeline gets the notes back, plus key detection, harmonisation, quantising and the MIDI writer.

## Credits

The electric bass (Swagbass, CC0) and upright bass (Meatbass, CC BY 4.0) are sample
libraries by Karoryfer Lecolds. See `samples/README.md` for details. The General MIDI
library is the Musyng Kite soundfont as rendered by
[gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) (CC BY-SA 3.0),
loaded from GitHub when an instrument is used.
