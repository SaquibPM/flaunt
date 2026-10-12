#!/usr/bin/env node
// Synthesize a royalty-free, beat-driven soundtrack in pure JavaScript: drums, bass, chords, arp,
// sidechain pumping, plus whooshes on every cut and a boom on the final reveal. No samples, no downloads.
//
// Usage: node music.mjs <seconds> <style> <out.wav> [--cuts 1.5,3.25,...]
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SR = 44100;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const CHORD = { maj: [0, 4, 7], min: [0, 3, 7] };

// kick/clap are beat indices within a 4-beat bar; hat is hits per beat; duck is sidechain depth.
export const STYLES = {
  bold: { bpm: 120, root: 40, prog: [[0, "maj"], [7, "maj"], [9, "min"], [5, "maj"]], kick: [0, 1, 2, 3], clap: [1, 3], hat: 2, arp: 4, duck: 0.65, bass: 0.55, pad: 0.13, arpGain: 0.07 },
  calm: { bpm: 84, root: 38, prog: [[0, "min"], [9, "maj"], [5, "maj"], [7, "maj"]], kick: [0, 2], clap: [3], hat: 1, arp: 2, duck: 0.4, bass: 0.45, pad: 0.17, arpGain: 0.05 },
  techy: { bpm: 112, root: 45, prog: [[0, "min"], [8, "maj"], [3, "maj"], [10, "maj"]], kick: [0, 1, 2, 3], clap: [1, 3], hat: 4, arp: 4, duck: 0.6, bass: 0.5, pad: 0.1, arpGain: 0.09 },
  warm: { bpm: 100, root: 36, prog: [[0, "maj"], [5, "maj"], [9, "min"], [7, "maj"]], kick: [0, 2], clap: [1, 3], hat: 2, arp: 2, duck: 0.5, bass: 0.5, pad: 0.15, arpGain: 0.06 },
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

export function renderMusic(seconds, style = "bold", cuts = []) {
  const c = STYLES[style] ?? STYLES.bold;
  const N = Math.ceil(seconds * SR);
  const beat = 60 / c.bpm;
  const bar = beat * 4;
  const noise = rng(7);

  const drums = new Float32Array(N);
  const duck = new Float32Array(N).fill(1);
  const bus = new Float32Array(N);
  const sfx = new Float32Array(N);

  const add = (buf, start, len, fn) => {
    const s0 = Math.max(0, Math.round(start * SR));
    for (let j = 0; j < len * SR && s0 + j < N; j++) buf[s0 + j] += fn(j / SR);
  };

  // --- drums + sidechain ---
  const beats = Math.ceil(seconds / beat);
  for (let b = 0; b < beats; b++) {
    const t = b * beat;
    const inBar = b % 4;
    if (c.kick.includes(inBar)) {
      add(drums, t, 0.4, (x) => Math.sin(2 * Math.PI * (48 * x + (120 * (1 - Math.exp(-25 * x))) / 25)) * Math.exp(-x * 8) * 0.95);
      const s0 = Math.round(t * SR);
      for (let j = 0; j < 0.45 * SR && s0 + j < N; j++) duck[s0 + j] = Math.min(duck[s0 + j], 1 - c.duck * Math.exp((-j / SR) * 9));
    }
    if (c.clap.includes(inBar)) {
      let prev = 0;
      add(drums, t, 0.22, (x) => { const n = noise(); const hp = n - prev; prev = n; return hp * Math.exp(-x * 20) * 0.32; });
    }
    for (let h = 0; h < c.hat; h++) {
      const ht = t + (h + (c.hat === 1 ? 0.5 : 0.5)) * (beat / c.hat);
      let prev = 0;
      add(drums, ht, 0.07, (x) => { const n = noise(); const hp = n - prev; prev = n; return hp * Math.exp(-x * 75) * 0.12; });
    }
  }

  // --- bass, pad, arp follow the chord progression, one chord per bar ---
  const bars = Math.ceil(seconds / bar);
  for (let k = 0; k < bars; k++) {
    const [off, type] = c.prog[k % c.prog.length];
    const t0 = k * bar;
    const rootF = mtof(c.root + off);

    // bass: root on beats + a pickup on the "and" of 2
    for (const bt of [0, 1, 2, 2.5, 3]) {
      add(bus, t0 + bt * beat, beat * 0.9, (x) => {
        const ph = 2 * Math.PI * rootF * x;
        const env = Math.min(1, x / 0.004) * Math.exp(-x * 3.2);
        return (Math.sin(ph) + 0.3 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph)) * env * c.bass;
      });
    }

    // pad: soft saw-ish chord, slow attack, lowpassed
    for (const iv of CHORD[type]) {
      const f = mtof(c.root + 12 + off + iv);
      let lp = 0;
      add(bus, t0, bar + 0.1, (x) => {
        let v = 0;
        for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * x + h) / h + Math.sin(2 * Math.PI * f * 1.004 * h * x) / h;
        lp += 0.12 * (v - lp);
        const env = Math.min(1, x / 0.18) * Math.min(1, (bar + 0.1 - x) / 0.2);
        return lp * env * c.pad;
      });
    }

    // arp: plucky notes through the chord
    if (c.arp) {
      const notes = CHORD[type].map((iv) => mtof(c.root + 24 + off + iv));
      const steps = 4 * c.arp;
      for (let s = 0; s < steps; s++) {
        const f = notes[[0, 1, 2, 1][s % 4]];
        add(bus, t0 + s * (bar / steps), 0.25, (x) => {
          const ph = 2 * Math.PI * f * x;
          return (Math.sin(ph) + 0.35 * Math.sign(Math.sin(ph))) * Math.exp(-x * 14) * c.arpGain;
        });
      }
    }
  }

  // --- whooshes on each cut (peak lands on the cut), boom on the last one ---
  cuts.forEach((tc, i) => {
    const rise = 0.42;
    let y = 0;
    add(sfx, tc - rise, rise + 0.25, (x) => {
      const fc = 300 + 7000 * Math.min(1, x / rise) ** 2;
      const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
      y += a * (noise() - y);
      const env = x < rise ? (x / rise) ** 2 : Math.exp(-(x - rise) * 25);
      return y * env * 1.1;
    });
    if (i === cuts.length - 1) {
      add(sfx, tc, 1.4, (x) => Math.sin(2 * Math.PI * (38 + 40 * Math.exp(-x * 6)) * x) * Math.exp(-x * 3.2) * 0.75);
    }
  });

  // --- master ---
  const out = new Int16Array(N * 2);
  let peak = 0;
  const mono = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const fadeOut = Math.min(1, (seconds - t) / 0.7);
    let v = (bus[i] * duck[i] + drums[i] + sfx[i]) * Math.max(0, fadeOut);
    v = Math.tanh(v * 1.35);
    mono[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const g = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < N; i++) {
    const s = Math.round(mono[i] * g * 32767);
    out[2 * i] = s;
    out[2 * i + 1] = s;
  }
  return out;
}

export function writeWav(path, samples) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [seconds, style = "bold", out] = process.argv.slice(2);
  if (!seconds || !out) {
    console.error("usage: node music.mjs <seconds> <style> <out.wav> [--cuts 1.5,3.25]");
    process.exit(2);
  }
  const ci = process.argv.indexOf("--cuts");
  const cuts = ci === -1 ? [] : process.argv[ci + 1].split(",").map(Number).filter(Number.isFinite);
  writeWav(out, renderMusic(Number(seconds), style, cuts));
  console.log(`music: ${seconds}s, ${style}, ${(STYLES[style] ?? STYLES.bold).bpm} BPM, ${cuts.length} cuts -> ${out}`);
}
