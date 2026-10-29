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
5. **Tracks and instruments** (`src/song.js`, `src/instruments/`): the song is the melody plus a list of tracks (bass, keys), each with an instrument, volume and mute. The bass instruments are real multi-sampled recordings, an electric bass and an upright bass with several velocity layers and round robins, plus a synth bass. Everything is scheduled with Web Audio, and the original recording can be played alongside.
6. **Export** (`src/midi.js`): download melody, bass and keys as a 3-track MIDI file for a DAW.

## Tests

```sh
npm test
```

The tests synthesise hummed melodies (harmonics, vibrato, detuning, noise) and check that the pipeline gets the notes back, plus key detection, harmonisation, quantising and the MIDI writer.

## Credits

The electric bass (Swagbass, CC0) and upright bass (Meatbass, CC BY 4.0) are sample
libraries by Karoryfer Lecolds. See `samples/README.md` for details.
