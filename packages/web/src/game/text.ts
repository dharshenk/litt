import type { GameEvent, Phase, Team } from "@litt/engine";
import { setInfo } from "../lib/cards.js";

/** Display names relative to the viewer: "You" for me, display names for others. */
export interface Namer {
  me: string | null;
  /** "You" / "Maya" */
  name(id: string): string;
  /** "you" / "Maya" (mid-sentence) */
  obj(id: string): string;
  /** Display name, even for me. */
  raw(id: string): string;
  /** "Your turn" / "Maya’s turn" */
  turn(id: string): string;
}

export function makeNamer(me: string | null, names: ReadonlyMap<string, string>): Namer {
  const raw = (id: string) => names.get(id) ?? id;
  return {
    me,
    raw,
    name: (id) => (id === me ? "You" : raw(id)),
    obj: (id) => (id === me ? "you" : raw(id)),
    turn: (id) => (id === me ? "Your turn" : `${raw(id)}’s turn`),
  };
}

export function initials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

export const teamLabel = (team: Team) => `Team ${team}`;

export type DeclaredEvent = Extract<GameEvent, { type: "declared" }>;

/** What a declaration did to the score: "Team A +1" or "The set is nullified." */
export function declarationResult(ev: DeclaredEvent): string {
  return ev.outcome === "NULL" ? "The set is nullified." : `Team ${ev.outcome === "WON_A" ? "A" : "B"} +1`;
}

export function declaredText(ev: DeclaredEvent, n: Namer): string {
  const set = setInfo(ev.set).name;
  return `${n.name(ev.player)} declared ${set} — ${ev.correct ? "correct" : "wrong"}. ${declarationResult(ev)}`;
}

export function timedOutText(phaseBefore: Phase | null, n: Namer): string {
  if (phaseBefore?.kind === "turn") return `Time’s up for ${n.obj(phaseBefore.player)}.`;
  return "Time’s up. A player was picked at random.";
}

export function gameOverText(ev: Extract<GameEvent, { type: "gameOver" }>): string {
  const { A, B } = ev.scores;
  return ev.result === "draw" ? `Game over. It’s a draw, ${A}–${B}.` : `Game over. Team ${ev.result} wins ${Math.max(A, B)}–${Math.min(A, B)}.`;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
