import { useSoundPref } from "./useSoundPref";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

interface ToneSpec {
  freq: number;
  start: number;
  duration: number;
  type?: OscillatorType;
  peak?: number;
}

function tone(spec: ToneSpec) {
  const audioCtx = getCtx();
  const { freq, start, duration, type = "sine", peak = 0.15 } = spec;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const startTime = audioCtx.currentTime + start;
  const endTime = startTime + duration;

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + Math.min(0.02, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(startTime);
  osc.stop(endTime + 0.02);
}

function play(sequence: ToneSpec[]) {
  if (useSoundPref.getState().muted) return;
  try {
    sequence.forEach(tone);
  } catch {
    // Audio playback isn't essential — never let it break gameplay.
  }
}

export function playCardSound() {
  play([{ freq: 520, start: 0, duration: 0.08, type: "triangle", peak: 0.12 }]);
}

export function playTrickWinSound() {
  play([
    { freq: 660, start: 0, duration: 0.1, type: "triangle", peak: 0.14 },
    { freq: 880, start: 0.09, duration: 0.14, type: "triangle", peak: 0.14 },
  ]);
}

export function playYourTurnSound() {
  play([{ freq: 784, start: 0, duration: 0.12, type: "sine", peak: 0.16 }]);
}

export function playRoundEndSound() {
  play([
    { freq: 523, start: 0, duration: 0.12, type: "sine", peak: 0.13 },
    { freq: 659, start: 0.11, duration: 0.12, type: "sine", peak: 0.13 },
    { freq: 784, start: 0.22, duration: 0.18, type: "sine", peak: 0.13 },
  ]);
}

export function playGameEndSound() {
  play([
    { freq: 523, start: 0, duration: 0.14, type: "triangle", peak: 0.16 },
    { freq: 659, start: 0.13, duration: 0.14, type: "triangle", peak: 0.16 },
    { freq: 784, start: 0.26, duration: 0.14, type: "triangle", peak: 0.16 },
    { freq: 1047, start: 0.39, duration: 0.28, type: "triangle", peak: 0.18 },
  ]);
}
