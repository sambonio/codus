# Instrument samples

Each folder is one multi-sampled instrument: MP3s plus a `manifest.json` that maps
them to pitches and velocity ranges (see `src/instruments/multisampler.js`).
Regenerate them from the original libraries with `tools/prepare-bass-samples.mjs`.

| Folder | Instrument | Source | License |
| --- | --- | --- | --- |
| `electric-bass/` | Swagbass by Karoryfer Lecolds (D. Smolken): Ibanez BTB-400QM with flatwound strings, recorded direct. 3 velocity layers, 2 round robins, sampled every minor third from F#1 to C4. | [sfzinstruments/karoryfer.swagbass](https://github.com/sfzinstruments/karoryfer.swagbass) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `upright-bass/` | Meatbass by Karoryfer Lecolds: 1958 Otto Rubner double bass, pizzicato, played by Drogomir Smolken and recorded by Ludwik Zamenhof. 4 velocity layers, 2 round robins, sampled every minor third from F#1 to C4. | [sfzinstruments/karoryfer.meatbass](https://github.com/sfzinstruments/karoryfer.meatbass) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

The samples were converted to mono MP3, trimmed to 4.5 s with a fade, and given one
gain per instrument so the velocity layers keep their natural balance. Each zone's
`tune` value (cents) corrects the recorded pitch measured after the attack.
