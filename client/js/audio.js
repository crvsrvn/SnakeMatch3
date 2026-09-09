// Fully synthesised sound effects, no audio files. A glass bead impact is a very short
// broadband transient plus a cluster of high inharmonic partials, decaying exponentially.

let ctx = null;
let master = null;
let noise = null;
let muted = false;

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const len = Math.floor(ctx.sampleRate * 0.25);
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
}

export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function tone(freq, t0, dur, gain, type = 'sine', endFreq = null) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function transient(t0, gain, freq, q, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/** Glass beads colliding; intensity 0..1 sets how hard */
export function sfxClink(intensity = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const k = 0.9 + Math.random() * 0.35;               // detune a little each time, or it sounds mechanical
  transient(t, 0.5 * intensity, 5200 * k, 1.2, 0.045); // the impact transient
  // Inharmonic partials, which is what makes glass and ceramic sound like themselves
  [2350, 3610, 5290, 7150].forEach((f, i) => {
    tone(f * k, t + i * 0.001, 0.18 + i * 0.05, (0.22 / (i + 1)) * intensity, 'sine', f * k * 0.88);
  });
}

/** Severing or grafting a tail: a duller, heavier hit */
export function sfxCrack(intensity = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  transient(t, 0.55 * intensity, 1800, 0.8, 0.09);
  tone(420, t, 0.22, 0.28 * intensity, 'triangle', 160);
  tone(1900 * (0.9 + Math.random() * 0.2), t, 0.14, 0.16 * intensity, 'sine', 1200);
}

/** A match: a rising chime */
export function sfxMatch(step = 0) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const base = 880 * Math.pow(2, Math.min(step, 5) / 12);
  [1, 1.5, 2].forEach((m, i) => tone(base * m, t + i * 0.045, 0.3, 0.16 / (i + 1), 'sine'));
  transient(t, 0.14, 7000, 2, 0.05);
}

export function sfxEat() {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(560, t, 0.1, 0.14, 'sine', 940);
}

export function sfxWin() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [0, 4, 7, 12].forEach((s, i) => tone(523.25 * Math.pow(2, s / 12), t + i * 0.09, 0.45, 0.2, 'triangle'));
}

export function sfxDie() {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(300, t, 0.5, 0.24, 'sawtooth', 70);
  transient(t, 0.3, 900, 0.6, 0.25);
}
