import { describe, expect, it } from "vitest";
import { SET_IDS, apply } from "../src/index.js";
import type { Assignment, GameState, SetStatus } from "../src/index.js";
import { codeOf, makeGame, resolveSets, run } from "./helpers.js";

type Outcome = Exclude<SetStatus, "ACTIVE">;

const ALL_TO_A1: Assignment = { "2H": "a1", "3H": "a1", "4H": "a1", "5H": "a1", "6H": "a1", "7H": "a1" };
// a2 does not hold 7H, so this is a wrong declaration.
const WRONG: Assignment = { ...ALL_TO_A1, "7H": "a2" };

/** Eight sets already resolved (a team-A wins, b team-B wins, the rest null); only LOW_H remains, all in a1's hand. */
function lastSet(a: number, b: number, mode: "award" | "null" = "award"): GameState {
  const state = makeGame({ mode, hands: { a1: ["2H", "3H", "4H", "5H", "6H", "7H"] } });
  const outcomes: Outcome[] = [
    ...Array<Outcome>(a).fill("WON_A"),
    ...Array<Outcome>(b).fill("WON_B"),
    ...Array<Outcome>(8 - a - b).fill("NULL"),
  ];
  const rest = SET_IDS.filter((s) => s !== "LOW_H");
  return resolveSets(state, Object.fromEntries(rest.map((s, i) => [s, outcomes[i]!])));
}

const declare = (assignment: Assignment) => ({ type: "declare", player: "a1", set: "LOW_H", assignment }) as const;

describe("game over", () => {
  it("team A wins with the higher score", () => {
    const { state, events } = run(lastSet(4, 3), declare(ALL_TO_A1));
    expect(state.scores).toEqual({ A: 5, B: 3 });
    expect(state.phase).toEqual({ kind: "over", result: "A" });
    expect(events.map((e) => e.type)).toEqual(["declared", "gameOver"]);
    expect(events[1]).toEqual({ type: "gameOver", result: "A", scores: { A: 5, B: 3 } });
  });

  it("team B wins when a wrong declaration awards it the last set", () => {
    const { state, events } = run(lastSet(3, 4, "award"), declare(WRONG));
    expect(state.scores).toEqual({ A: 3, B: 5 });
    expect(state.phase).toEqual({ kind: "over", result: "B" });
    expect(events[events.length - 1]).toEqual({ type: "gameOver", result: "B", scores: { A: 3, B: 5 } });
  });

  it("is a draw when null mode leaves the scores level", () => {
    const { state, events } = run(lastSet(4, 4, "null"), declare(WRONG));
    expect(state.sets.LOW_H).toBe("NULL");
    expect(state.scores).toEqual({ A: 4, B: 4 });
    expect(state.phase).toEqual({ kind: "over", result: "draw" });
    expect(events[events.length - 1]).toEqual({ type: "gameOver", result: "draw", scores: { A: 4, B: 4 } });
  });

  it("emits no hand-off event once the game is over", () => {
    const { events } = run(lastSet(4, 3), declare(ALL_TO_A1));
    expect(events.some((e) => e.type === "chooseRequired" || e.type === "turnChanged")).toBe(false);
  });

  it("does not end the game while another set is still active", () => {
    const early = makeGame({ hands: { a1: ["2H", "3H", "4H", "5H", "6H", "7H"] } });
    const next = run(early, declare(ALL_TO_A1)).state;
    expect(next.phase.kind).not.toBe("over");
  });

  describe("after the game ends", () => {
    const over = () => run(lastSet(4, 3), declare(ALL_TO_A1)).state;

    it.each([
      ["ask", { type: "ask", player: "a1", target: "b1", card: "2C" }],
      ["declare", { type: "declare", player: "a1", set: "LOW_H", assignment: ALL_TO_A1 }],
      ["choose", { type: "choose", player: "a1", choice: "a1" }],
      ["timeout", { type: "timeout" }],
    ] as const)("%s returns GAME_OVER", (_name, action) => {
      expect(codeOf(over(), action)).toBe("GAME_OVER");
    });

    it("returns GAME_OVER even for unknown players", () => {
      const result = apply(over(), { type: "ask", player: "nobody", target: "x", card: "2C" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("GAME_OVER");
    });
  });
});
