import { describe, expect, it } from "vitest";
import { LOW_H_ASSIGNMENT, makeGame, rngOf, run, teamAGame } from "./helpers.js";

const timeout = { type: "timeout" } as const;

describe("timeout in a turn phase", () => {
  // a1 is active; b1, b2, b3 all hold cards.
  const game = () => makeGame({ hands: { a1: ["2H"], b1: ["3H"], b2: ["4H"] } });

  it("passes the turn to a random opponent who holds cards", () => {
    expect(run(game(), timeout, rngOf(0)).state.phase).toEqual({ kind: "turn", player: "b1" });
    expect(run(game(), timeout, rngOf(0.5)).state.phase).toEqual({ kind: "turn", player: "b2" });
    expect(run(game(), timeout, rngOf(0.99)).state.phase).toEqual({ kind: "turn", player: "b3" });
  });

  it("emits timedOut then turnChanged", () => {
    const { events } = run(game(), timeout, rngOf(0));
    expect(events).toEqual([
      { type: "timedOut", phase: "turn" },
      { type: "turnChanged", player: "b1" },
    ]);
  });

  it("skips opponents who are out of cards", () => {
    const state = makeGame({ hands: { a1: ["2H"], b1: [], b2: [] } });
    expect(run(state, timeout, rngOf(0)).state.phase).toEqual({ kind: "turn", player: "b3" });
  });

  it("is deterministic for a given rng sequence", () => {
    const a = run(game(), timeout, rngOf(0.3));
    const b = run(game(), timeout, rngOf(0.3));
    expect(a).toEqual(b);
  });

  it("falls back to a random teammate with cards when no opponent has any", () => {
    const state = makeGame({ hands: { a2: [], b1: [], b2: [], b3: [] } });
    // a1 (active) and a3 hold everything; a2 is empty; only a3 qualifies as "other teammate with cards".
    const { state: next, events } = run(state, timeout, rngOf(0));
    expect(next.phase).toEqual({ kind: "turn", player: "a3" });
    expect(events).toEqual([
      { type: "timedOut", phase: "turn" },
      { type: "turnChanged", player: "a3" },
    ]);
  });

  it("picks among several teammates with the rng, never the active player", () => {
    const state = makeGame({ hands: { a1: ["2H"], a2: ["3H"], b1: [], b2: [], b3: [] } });
    expect(run(state, timeout, rngOf(0)).state.phase).toEqual({ kind: "turn", player: "a2" });
    expect(run(state, timeout, rngOf(0.99)).state.phase).toEqual({ kind: "turn", player: "a3" });
  });

  it("keeps the turn with the active player when nobody else has cards, and still emits turnChanged", () => {
    const state = makeGame({ hands: { a2: [], a3: [], b1: [], b2: [], b3: [] } });
    const { state: next, events } = run(state, timeout, rngOf(0));
    expect(next.phase).toEqual({ kind: "turn", player: "a1" });
    expect(events).toEqual([
      { type: "timedOut", phase: "turn" },
      { type: "turnChanged", player: "a1" },
    ]);
  });
});

describe("timeout in a choose phase", () => {
  const choosing = () => run(teamAGame(), { type: "declare", player: "a1", set: "LOW_H", assignment: LOW_H_ASSIGNMENT }).state;

  it("picks a random eligible player", () => {
    expect(run(choosing(), timeout, rngOf(0)).state.phase).toEqual({ kind: "turn", player: "a1" });
    expect(run(choosing(), timeout, rngOf(0.5)).state.phase).toEqual({ kind: "turn", player: "a2" });
    expect(run(choosing(), timeout, rngOf(0.99)).state.phase).toEqual({ kind: "turn", player: "a3" });
  });

  it("emits timedOut for the choose phase, then turnChanged", () => {
    const { events } = run(choosing(), timeout, rngOf(0.99));
    expect(events).toEqual([
      { type: "timedOut", phase: "choose" },
      { type: "turnChanged", player: "a3" },
    ]);
  });
});
