// The instrument builder: turn a short description like "warm strings pad"
// or "funky clavinet" into an instrument and a part to play.
import { INSTRUMENTS } from './instruments/index.js';

// Words people use, mapped to instrument ids. Earlier entries win.
const INSTRUMENT_WORDS = [
  [/\bhammond|b3|gospel organ|church\b/, 'organ-gospel'],
  [/\bjazz organ\b/, 'organ-jazz'],
  [/\brock organ\b/, 'organ-rock'],
  [/\borgan\b/, 'organ-gospel'],
  [/\brhodes|electric piano|\bep\b|wurli/, 'gm-electric_piano_1'],
  [/\bclav/, 'gm-clavinet'],
  [/\bharpsichord/, 'gm-harpsichord'],
  [/\bpiano|keys\b/, 'gm-acoustic_grand_piano'],
  [/\bstrings?\b|orchestra|ensemble/, 'gm-string_ensemble_1'],
  [/\bviolin|fiddle/, 'gm-violin'],
  [/\bcello/, 'gm-cello'],
  [/\bviola/, 'gm-viola'],
  [/\bharp\b/, 'gm-orchestral_harp'],
  [/\bchoir|voices|vocals?|aah|ooh/, 'gm-choir_aahs'],
  [/\bbrass|horns? section/, 'gm-brass_section'],
  [/\btrumpet/, 'gm-trumpet'],
  [/\btrombone/, 'gm-trombone'],
  [/\bfrench horn|\bhorn\b/, 'gm-french_horn'],
  [/\btenor sax/, 'gm-tenor_sax'],
  [/\bbari(tone)? sax/, 'gm-baritone_sax'],
  [/\bsax/, 'gm-alto_sax'],
  [/\bclarinet/, 'gm-clarinet'],
  [/\boboe/, 'gm-oboe'],
  [/\bflute/, 'gm-flute'],
  [/\bpan ?pipes?|pan flute/, 'gm-pan_flute'],
  [/\bwhistle/, 'gm-whistle'],
  [/\bharmonica/, 'gm-harmonica'],
  [/\baccordion/, 'gm-accordion'],
  [/\bnylon|classical guitar|spanish guitar/, 'gm-acoustic_guitar_nylon'],
  [/\bacoustic guitar/, 'gm-acoustic_guitar_steel'],
  [/\bdistort|heavy guitar|metal/, 'gm-distortion_guitar'],
  [/\boverdrive|crunch/, 'gm-overdriven_guitar'],
  [/\bjazz guitar/, 'gm-electric_guitar_jazz'],
  [/\bmuted guitar/, 'gm-electric_guitar_muted'],
  [/\bguitar/, 'gm-electric_guitar_clean'],
  [/\bupright bass|double bass|acoustic bass/, 'upright-bass'],
  [/\bslap/, 'gm-slap_bass_1'],
  [/\bfretless/, 'gm-fretless_bass'],
  [/\bsynth bass|808/, 'synth-bass'],
  [/\bbass\b/, 'electric-bass'],
  [/\bvibes|vibraphone/, 'gm-vibraphone'],
  [/\bmarimba/, 'gm-marimba'],
  [/\bxylophone/, 'gm-xylophone'],
  [/\bglock|bells?\b|chime/, 'gm-glockenspiel'],
  [/\bmusic box/, 'gm-music_box'],
  [/\bcelest/, 'gm-celesta'],
  [/\bkalimba/, 'gm-kalimba'],
  [/\bsteel drum|steel pan/, 'gm-steel_drums'],
  [/\bsitar/, 'gm-sitar'],
  [/\bbanjo/, 'gm-banjo'],
  [/\bkoto/, 'gm-koto'],
  [/\bbagpipe/, 'gm-bagpipe'],
  [/\bwarm pad|\bpad\b/, 'gm-pad_2_warm'],
  [/\bsynth strings/, 'gm-synth_strings_1'],
  [/\bsynth brass/, 'gm-synth_brass_1'],
  [/\bsaw|lead synth|synth lead/, 'gm-lead_2_sawtooth'],
  [/\bsquare|chiptune|8.?bit/, 'gm-lead_1_square'],
  [/\bsynth/, 'gm-pad_3_polysynth'],
  // Moods, when no instrument is named.
  [/\bdreamy|ambient|ethereal|floaty/, 'gm-pad_7_halo'],
  [/\bspooky|creepy|dark|eerie|haunting/, 'gm-fx_4_atmosphere'],
  [/\bepic|cinematic|film|soundtrack/, 'gm-string_ensemble_2'],
  [/\bhappy|sparkl|bright|twinkl|cute/, 'gm-glockenspiel'],
  [/\bretro|80s|eighties/, 'gm-synth_brass_1'],
  [/\bsoul|church\b/, 'organ-gospel'],
];

const PART_WORDS = [
  [/\barp|arpeggi|broken chord|picked|plucked|fingerpick/, 'arpeggio'],
  [/\bstab|hits?\b|chop|staccato|skank|funky|groove|rhythm/, 'stabs'],
  [/\bharmon|third|counter|backing line/, 'harmony'],
  [/\bmelody|lead\b|double|unison|tune\b|solo/, 'double'],
  [/\bpad|chords?|sustain|hold|swell|bed\b|background/, 'pad'],
];

// What each kind of instrument usually plays if the description doesn't say.
const DEFAULT_PART_BY_FAMILY = {
  Piano: 'arpeggio', 'Mallets & bells': 'arpeggio', Guitar: 'arpeggio', World: 'arpeggio',
  Organ: 'pad', Strings: 'pad', Voices: 'pad', Synth: 'pad', Effects: 'pad',
  Brass: 'stabs', Reeds: 'harmony', Flutes: 'harmony', Bass: 'double', Percussion: 'stabs',
};
const DEFAULT_PART_BY_ROLE = { keys: 'pad', bass: 'double' };

function familyOf(inst) {
  if (inst.family) return inst.family;
  return inst.role === 'keys' ? 'Organ' : 'Bass';
}

/**
 * Build a track description from free text. Returns
 * { instrument, part, name } or null if nothing recognisable was asked for.
 */
export function buildFromDescription(text) {
  const q = ` ${text.toLowerCase().trim()} `;
  if (!q.trim()) return null;

  let instrumentId = INSTRUMENT_WORDS.find(([re]) => re.test(q))?.[1];
  if (!instrumentId) {
    // Fall back to any instrument whose name appears in the text.
    instrumentId = INSTRUMENTS.find((i) => q.includes(i.name.toLowerCase().replace(/ \(.*\)/, '')))?.id;
  }
  const partFromWords = PART_WORDS.find(([re]) => re.test(q))?.[1];
  if (!instrumentId && !partFromWords) return null;

  const inst = INSTRUMENTS.find((i) => i.id === (instrumentId ?? 'gm-pad_2_warm'));
  const part = partFromWords ?? DEFAULT_PART_BY_FAMILY[familyOf(inst)] ?? DEFAULT_PART_BY_ROLE[inst.role] ?? 'pad';
  const name = inst.name.replace(/ \(.*\)/, '');
  return { instrument: inst.id, part, name };
}

export const SUGGESTIONS = [
  'Warm strings pad',
  'Piano arpeggios',
  'Funky clavinet',
  'Brass stabs',
  'Flute harmony',
  'Choir pad',
  'Rhodes chords',
  'Nylon guitar picking',
];
