// Multi-sampled instruments: several velocity layers and round robins per
// note, described by a manifest.json next to the sample files.

/**
 * Pick the zone for a note: the closest sampled pitch whose velocity range
 * covers the note. Pure, so it can be tested without audio.
 */
export function pickZone(zones, midi, velocity127) {
  let best = null;
  let bestDistance = Infinity;
  for (const zone of zones) {
    if (velocity127 < zone.lovel || velocity127 > zone.hivel) continue;
    const distance = Math.abs(zone.key - midi);
    // On a tie prefer pitching a sample down, which sounds more natural than up.
    if (distance < bestDistance || (distance === bestDistance && zone.key > best.key)) {
      best = zone;
      bestDistance = distance;
    }
  }
  return best;
}

/** Map a 0..1 note velocity (from how loud the melody was hummed) onto MIDI velocity. */
export function toMidiVelocity(velocity) {
  return Math.max(1, Math.min(127, Math.round(127 * (0.35 + 0.65 * velocity))));
}

function trimOnset(buffer) {
  const data = buffer.getChannelData(0);
  let peak = 1e-6;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  // MP3 encoders add a little silence; skip it so notes land on the beat.
  let onset = 0;
  while (onset < data.length && Math.abs(data[onset]) < peak * 0.01) onset++;
  return Math.max(0, onset - Math.floor(buffer.sampleRate * 0.0015)) / buffer.sampleRate;
}

/**
 * Load a multi-sampled instrument from `baseUrl` (a folder containing
 * manifest.json). Returns { name, credit, play(ctx, out, note) }.
 */
export async function loadMultisampler(ctx, baseUrl, { level = 1, reverb = 0 } = {}) {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, location.href);
  const res = await fetch(new URL('manifest.json', base));
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${base}manifest.json`);
  const manifest = await res.json();

  const decode = async (file) => {
    const r = await fetch(new URL(file, base));
    if (!r.ok) throw new Error(`HTTP ${r.status} loading ${file}`);
    const buffer = await ctx.decodeAudioData(await r.arrayBuffer());
    return { buffer, offset: trimOnset(buffer) };
  };
  const zones = await Promise.all(manifest.zones.map(async (zone) => ({
    ...zone,
    samples: await Promise.all(zone.files.map(decode)),
    next: 0,
  })));

  const release = manifest.release ?? 0.05;
  return {
    name: manifest.name,
    credit: manifest.credit,
    reverb,
    play(ctx, out, { midi, start, duration, velocity = 0.8 }) {
      const zone = pickZone(zones, midi, toMidiVelocity(velocity));
      if (!zone) return;
      // Cycle round robins so repeated notes don't sound machine-gunned.
      const sample = zone.samples[zone.next];
      zone.next = (zone.next + 1) % zone.samples.length;

      const end = start + Math.max(0.05, duration);
      const source = ctx.createBufferSource();
      source.buffer = sample.buffer;
      source.playbackRate.value = Math.pow(2, (midi - zone.key + (zone.tune ?? 0) / 100) / 12);

      const amp = ctx.createGain();
      amp.gain.setValueAtTime(level, start);
      // Damp the string at note-off, smoothly so there's no click.
      amp.gain.setTargetAtTime(0, end, release);

      source.connect(amp).connect(out);
      source.start(start, sample.offset);
      source.stop(end + release * 8);
    },
  };
}
