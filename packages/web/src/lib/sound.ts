import { useSyncExternalStore } from "react";
import { readStorage, writeStorage } from "./storage.js";

export type SoundKind = "turn" | "got" | "soft" | "fail" | "win" | "wrong" | "tick" | "deal";

const MUTE_KEY = "litt_muted";
let muted = readStorage("local", MUTE_KEY) === "1";
const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;

export function setMuted(value: boolean): void {
  muted = value;
  writeStorage("local", MUTE_KEY, value ? "1" : null);
  listeners.forEach((l) => l());
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => muted,
  );
}

/** Short Web Audio oscillator cues; no audio files. */
export function playSound(kind: SoundKind): void {
  if (muted) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const c = ctx;
    const t0 = c.currentTime;
    const tone = (freq: number, dur: number, at = 0, type: OscillatorType = "sine", vol = 0.08) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0 + at);
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.05);
    };
    switch (kind) {
      case "turn":
        tone(660, 0.25);
        tone(990, 0.35, 0.12);
        break;
      case "got":
        tone(740, 0.12, 0, "triangle");
        tone(1110, 0.18, 0.07, "triangle");
        break;
      case "soft":
        tone(540, 0.1, 0, "triangle", 0.04);
        break;
      case "fail":
        tone(260, 0.18, 0, "triangle", 0.07);
        tone(196, 0.28, 0.1, "triangle", 0.07);
        break;
      case "win":
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, i * 0.08, "triangle", 0.07));
        break;
      case "wrong":
        tone(233, 0.25, 0, "sawtooth", 0.025);
        tone(185, 0.4, 0.15, "sawtooth", 0.025);
        break;
      case "tick":
        tone(1400, 0.04, 0, "square", 0.02);
        break;
      case "deal":
        [0, 1, 2, 3, 4, 5].forEach((i) => tone(880 + i * 30, 0.04, i * 0.05, "triangle", 0.03));
        break;
    }
  } catch {
    // Audio is optional.
  }
}
