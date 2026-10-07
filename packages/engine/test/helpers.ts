import { ALL_CARDS, setOf } from "../src/cards.js";
import type { Card, SetId } from "../src/cards.js";
import { apply, createGame } from "../src/game.js";
import type {
  Assignment,
  Action,
  ApplyResult,
  ErrorCode,
  GameConfig,
  GameEvent,
  GameState,
  PlayerSeat,
  Rng,
  SetStatus,
} from "../src/types.js";

/** Seats alternate teams: a1, b1, a2, b2, … */
export function seats(n = 6): PlayerSeat[] {
  return Array.from({ length: n }, (_, i) => {
    const team = i % 2 === 0 ? "A" : "B";
    return { id: `${team.toLowerCase()}${Math.floor(i / 2) + 1}`, team } as PlayerSeat;
  });
}

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function canonical(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => ALL_CARDS.indexOf(a) - ALL_CARDS.indexOf(b));
}

export interface MakeGameOptions {
  /** Hands for some players. Players not listed split the remaining cards round-robin. */
  hands?: Record<string, Card[]>;
  players?: PlayerSeat[];
  first?: string;
  mode?: GameConfig["wrongDeclaration"];
  historyLimit?: number;
}

export function makeGame(opts: MakeGameOptions = {}): GameState {
  const players = opts.players ?? seats(6);
  const given = opts.hands ?? {};
  const used = new Set(Object.values(given).flat());
  const rest = ALL_CARDS.filter((c) => !used.has(c));
  const free = players.filter((p) => !Object.hasOwn(given, p.id));
  const deal: Record<string, Card[]> = {};
  for (const p of players) deal[p.id] = [...(given[p.id] ?? [])];
  if (free.length === 0 && rest.length > 0) throw new Error("makeGame: cards left over but no player to take them");
  rest.forEach((card, i) => deal[free[i % free.length]!.id]!.push(card));

  const result = createGame({
    players,
    config: { wrongDeclaration: opts.mode ?? "award", historyLimit: opts.historyLimit ?? 3 },
    deal,
    firstPlayer: opts.first ?? players[0]!.id,
  });
  if (!result.ok) throw new Error(`makeGame: ${result.error.code} ${result.error.message}`);
  return result.state;
}

export const LOW_H_ASSIGNMENT: Assignment = {
  "2H": "a1",
  "3H": "a1",
  "4H": "a2",
  "5H": "a2",
  "6H": "a3",
  "7H": "a3",
};

export const HIGH_S_ASSIGNMENT: Assignment = {
  "9S": "a1",
  QS: "a1",
  "10S": "a2",
  KS: "a2",
  JS: "a3",
  AS: "a3",
};

/** Team A holds all of Low ♥ and High ♠, split across a1/a2/a3; team B holds the rest. a1 to play. */
export function teamAGame(over: MakeGameOptions = {}): GameState {
  return makeGame({
    ...over,
    hands: {
      a1: ["2H", "3H", "9S", "QS"],
      a2: ["4H", "5H", "10S", "KS"],
      a3: ["6H", "7H", "JS", "AS"],
      ...over.hands,
    },
  });
}

export function run(state: GameState, action: Action, rng?: Rng): { state: GameState; events: GameEvent[] } {
  const result = apply(state, action, rng);
  if (!result.ok) throw new Error(`Expected ${action.type} to succeed: ${result.error.code} ${result.error.message}`);
  return result;
}

export function codeOf(state: GameState, action: Action, rng?: Rng): ErrorCode {
  const result: ApplyResult = apply(state, action, rng);
  if (result.ok) throw new Error(`Expected ${action.type} to be rejected`);
  return result.error.code;
}

export function mutate(state: GameState, fn: (draft: GameState) => void): GameState {
  const draft = clone(state);
  fn(draft);
  return draft;
}

/** Marks sets as resolved without playing them: removes their cards and updates scores/resolutions. */
export function resolveSets(state: GameState, outcomes: Partial<Record<SetId, Exclude<SetStatus, "ACTIVE">>>): GameState {
  return mutate(state, (s) => {
    for (const [set, outcome] of Object.entries(outcomes) as [SetId, Exclude<SetStatus, "ACTIVE">][]) {
      s.sets[set] = outcome;
      if (outcome === "WON_A") s.scores.A += 1;
      if (outcome === "WON_B") s.scores.B += 1;
      for (const id of Object.keys(s.hands)) s.hands[id] = s.hands[id]!.filter((c) => setOf(c) !== set);
      s.resolutions.push({ set, declaredBy: "a1", team: "A", correct: outcome !== "NULL", outcome });
    }
  });
}

/** Rng that cycles through the given values. */
export const rngOf =
  (...values: number[]): Rng =>
  {
    let i = 0;
    return () => values[i++ % values.length]!;
  };

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export const snapshot = (value: unknown): string => JSON.stringify(value);
