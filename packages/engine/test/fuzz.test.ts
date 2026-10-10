import { describe, expect, it } from "vitest";
import { SET_IDS, apply, cardsInSet, createGame, playerView, seededRng, setOf } from "../src/index.js";
import type { Action, Assignment, GameEvent, GameState, PlayerSeat, Rng, SetId } from "../src/index.js";
import { canonical, seats, snapshot } from "./helpers.js";

const GAMES = 250;
const MAX_STEPS = 5000;

function checkInvariants(s: GameState): void {
  const inHands = Object.values(s.hands).flat();
  const active = SET_IDS.filter((x) => s.sets[x] === "ACTIVE");

  expect(inHands.length, "cards in hands = 6 × active sets").toBe(6 * active.length);
  expect(new Set(inHands).size, "no card appears twice").toBe(inHands.length);
  for (const card of inHands) expect(s.sets[setOf(card)], `${card} is in a resolved set`).toBe("ACTIVE");
  for (const set of active) for (const card of cardsInSet(set)) expect(inHands, `${card} is missing`).toContain(card);

  for (const team of ["A", "B"] as const) {
    expect(s.scores[team], `team ${team} score`).toBe(SET_IDS.filter((x) => s.sets[x] === `WON_${team}`).length);
  }
  expect(s.resolutions.length, "one resolution per non-active set").toBe(SET_IDS.length - active.length);
  for (const r of s.resolutions) expect(s.sets[r.set], `resolution for ${r.set}`).toBe(r.outcome);
  expect(new Set(s.resolutions.map((r) => r.set)).size).toBe(s.resolutions.length);

  expect(s.history.length).toBeLessThanOrEqual(s.config.historyLimit);
  for (const hand of Object.values(s.hands)) expect(hand, "hand is canonical").toEqual(canonical(hand));

  if (s.phase.kind === "turn") expect(s.hands[s.phase.player]!.length, "active player has cards").toBeGreaterThan(0);
  if (s.phase.kind === "choose") {
    expect(s.phase.eligible.length).toBeGreaterThan(0);
    for (const id of s.phase.eligible) expect(s.hands[id]!.length, `eligible ${id} has cards`).toBeGreaterThan(0);
  }
}

/** A declared event must say where the set's cards really were, and `correct` must agree with it. */
function checkDeclared(before: GameState, events: GameEvent[]): void {
  for (const event of events) {
    if (event.type !== "declared") continue;
    const cards = cardsInSet(event.set);
    expect(Object.keys(event.holders), "holders cover exactly the set").toEqual([...cards]);
    for (const card of cards) {
      expect(before.hands[event.holders[card]!], `${card} was not with ${event.holders[card]}`).toContain(card);
    }
    expect(event.correct, "correct agrees with holders").toBe(cards.every((card) => event.holders[card] === event.assignment[card]));
  }
}

function legalMoves(s: GameState): { asks: Action[]; declares: (rng: Rng) => Action[] } {
  if (s.phase.kind !== "turn") return { asks: [], declares: () => [] };
  const me = s.phase.player;
  const team = s.players.find((p) => p.id === me)!.team;
  const hand = s.hands[me]!;
  const opponents = s.players.filter((p) => p.team !== team && s.hands[p.id]!.length > 0);
  const mates = s.players.filter((p) => p.team === team);
  const held = new Set<SetId>(hand.map(setOf));

  const asks: Action[] = [];
  for (const set of held) {
    for (const card of cardsInSet(set)) {
      if (hand.includes(card)) continue;
      for (const o of opponents) asks.push({ type: "ask", player: me, target: o.id, card });
    }
  }

  const declares = (rng: Rng): Action[] =>
    [...held].map((set) => {
      const correct: Assignment = {};
      const random: Assignment = {};
      for (const card of cardsInSet(set)) {
        correct[card] = (mates.find((m) => s.hands[m.id]!.includes(card)) ?? mates[0]!).id;
        random[card] = mates[Math.floor(rng() * mates.length)]!.id;
      }
      return { type: "declare", player: me, set, assignment: rng() < 0.5 ? correct : random };
    });

  return { asks, declares };
}

function chooserOf(s: GameState): string {
  if (s.phase.kind !== "choose") throw new Error("not choosing");
  const { chooser } = s.phase;
  return "player" in chooser ? chooser.player : s.players.find((p) => p.team === chooser.team)!.id;
}

function nextAction(s: GameState, rng: Rng): Action {
  if (s.phase.kind === "choose") {
    if (rng() < 0.1) return { type: "timeout" };
    const eligible = s.phase.eligible;
    return { type: "choose", player: chooserOf(s), choice: eligible[Math.floor(rng() * eligible.length)]! };
  }
  const { asks, declares } = legalMoves(s);
  const decls = declares(rng);
  // The active player always has at least one legal action.
  expect(asks.length + decls.length, "active player has a legal action").toBeGreaterThan(0);
  const r = rng();
  if (r < 0.03) return { type: "timeout" };
  if ((r < 0.12 && decls.length > 0) || asks.length === 0) return decls[Math.floor(rng() * decls.length)]!;
  return asks[Math.floor(rng() * asks.length)]!;
}

function playGame(seed: number): { steps: number; state: GameState } {
  const rng = seededRng(seed);
  const n = 6 + 2 * Math.floor(rng() * 4);
  const players: PlayerSeat[] = seats(n);
  const created = createGame({
    players,
    rng,
    config: { wrongDeclaration: rng() < 0.5 ? "award" : "null", historyLimit: 1 + Math.floor(rng() * 4) },
  });
  if (!created.ok) throw new Error(`seed ${seed}: ${created.error.message}`);

  let state = created.state;
  checkInvariants(state);
  let steps = 0;
  while (state.phase.kind !== "over" && steps < MAX_STEPS) {
    const action = nextAction(state, rng);
    const before = snapshot(state);
    const result = apply(state, action, rng);
    expect(snapshot(state), "apply mutated its input").toBe(before);
    if (!result.ok) throw new Error(`seed ${seed}: legal move rejected ${snapshot(action)}: ${result.error.code}`);
    checkDeclared(state, result.events);
    state = result.state;
    checkInvariants(state);
    steps++;
  }
  return { steps, state };
}

describe("fuzz: random legal playouts", () => {
  it(
    `keeps every invariant across ${GAMES} seeded games of 6–12 players, and each reaches game over`,
    () => {
      let longest = 0;
      for (let seed = 1; seed <= GAMES; seed++) {
        const { steps, state } = playGame(seed);
        expect(state.phase.kind, `seed ${seed} did not finish within ${MAX_STEPS} steps`).toBe("over");
        longest = Math.max(longest, steps);
      }
      expect(longest).toBeLessThan(MAX_STEPS);
    },
    180_000,
  );

  it("never leaks another player's cards through playerView at any step", () => {
    const rng = seededRng(99);
    const created = createGame({ players: seats(8), rng, config: { wrongDeclaration: "null", historyLimit: 3 } });
    if (!created.ok) throw new Error("setup failed");
    let state = created.state;
    for (let step = 0; step < 300 && state.phase.kind !== "over"; step++) {
      const result = apply(state, nextAction(state, rng), rng);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
      const publicCards = new Set([
        ...state.history.map((transfer) => transfer.card),
        ...playerView(state, state.players[0]!.id).recentAsks.map((attempt) => attempt.card),
      ]);
      for (const viewer of state.players) {
        const json = snapshot(playerView(state, viewer.id));
        for (const other of state.players) {
          if (other.id === viewer.id) continue;
          for (const card of state.hands[other.id]!) {
            if (state.hands[viewer.id]!.includes(card) || publicCards.has(card)) continue;
            expect(json.includes(`"${card}"`), `${viewer.id} can see ${card}`).toBe(false);
          }
        }
      }
    }
  });
});
