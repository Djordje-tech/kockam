// Every sound in the game is synthesised here — no audio files to load, no
// bundle weight, and it still lands the little hit of feedback that makes a
// round feel like something happened.

const STORAGE_KEY = "kockam_muted";

let ctx = null;
let muted = localStorage.getItem(STORAGE_KEY) === "1";
const listeners = new Set();

export const isMuted = () => muted;

export function setMuted(value) {
  muted = value;
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  for (const fn of listeners) fn(muted);
}

export function onMuteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Browsers won't start audio until the user has interacted, so the context is
// created on the first sound (which is always triggered by a click) and
// resumed if it was suspended in the meantime.
function audio() {
  if (muted) return null;
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// One note: a frequency (optionally sweeping to another) shaped by a short
// attack and an exponential tail so nothing clicks or drones.
function tone({ freq, to, type = "sine", dur = 0.18, gain = 0.18, delay = 0 }) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  vol.gain.setValueAtTime(0.0001, t0);
  vol.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(vol).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Filtered white noise — the texture behind coin rattle and the bust thud.
function noise({ dur = 0.25, gain = 0.12, freq = 1200, type = "lowpass", delay = 0 }) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const frames = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  const vol = ac.createGain();
  vol.gain.setValueAtTime(gain, t0);
  vol.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(vol).connect(ac.destination);
  src.start(t0);
}

const arpeggio = (freqs, step = 0.09, opts = {}) =>
  freqs.forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.22, delay: i * step, ...opts }));

export const sfx = {
  click: () => tone({ freq: 520, type: "square", dur: 0.05, gain: 0.06 }),
  chip: () => {
    tone({ freq: 880, type: "square", dur: 0.05, gain: 0.07 });
    noise({ dur: 0.09, gain: 0.05, freq: 4000, type: "highpass", delay: 0.02 });
  },
  deal: () => {
    tone({ freq: 320, to: 720, type: "sawtooth", dur: 0.22, gain: 0.1 });
    noise({ dur: 0.18, gain: 0.06, freq: 2600, type: "highpass" });
  },
  // Every second of the last five, rising as the clock runs out.
  tick: (urgent = false) =>
    tone({ freq: urgent ? 1100 : 760, type: "square", dur: 0.05, gain: urgent ? 0.11 : 0.06 }),
  pin: () => tone({ freq: 660, to: 990, type: "sine", dur: 0.12, gain: 0.1 }),
  win: () => arpeggio([523, 659, 784]),
  jackpot: () => {
    arpeggio([523, 659, 784, 1047, 1319], 0.08, { gain: 0.22 });
    noise({ dur: 0.7, gain: 0.07, freq: 5000, type: "highpass", delay: 0.1 });
    tone({ freq: 1568, type: "triangle", dur: 0.9, gain: 0.14, delay: 0.42 });
  },
  push: () => tone({ freq: 400, type: "sine", dur: 0.3, gain: 0.1 }),
  bust: () => {
    tone({ freq: 220, to: 70, type: "sawtooth", dur: 0.55, gain: 0.16 });
    noise({ dur: 0.4, gain: 0.1, freq: 500 });
  },
  // The streak climbing — pitched by how long the run is, so a hot streak
  // literally sounds higher than a cold start.
  streakUp: (streak) => tone({ freq: 520 + Math.min(streak, 8) * 90, type: "triangle", dur: 0.2, gain: 0.16 }),
  streakLost: () => arpeggio([600, 480, 360], 0.1, { type: "sine", gain: 0.14 }),
  // A short rattle to run under the payout counting up.
  counting: () => {
    for (let i = 0; i < 5; i++) noise({ dur: 0.05, gain: 0.04, freq: 5000, type: "highpass", delay: i * 0.08 });
  },
  nearMiss: () => tone({ freq: 900, to: 500, type: "sine", dur: 0.45, gain: 0.13 }),
};
