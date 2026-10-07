import { describe, expect, it } from "vitest";
import { apply } from "../src/index.js";
import type { Action, GameState } from "../src/index.js";
import { HIGH_S_ASSIGNMENT, LOW_H_ASSIGNMENT, deepFreeze, makeGame, rngOf, run, snapshot, teamAGame } from "./helpers.js";

const base = () =>
  makeGame({ hands: { a1: ["3H", "7H", "KC", "9S"], b1: ["5H", "QS"], b2: ["6H"], b3: [] } });
const choosing = () => run(teamAGame(), { type: "declare", player: "a1", set: "LOW_H", assignment: LOW_H_ASSIGNMENT }).state;

const cases: [string, () => GameState, Action][] = [
  ["a successful ask", base, { type: "ask", player: "a1", target: "b1", card: "5H" }],
  ["a failed ask", base, { type: "ask", player: "a1", target: "b2", card: "5H" }],
  ["a correct declaration", teamAGame, { type: "declare", player: "a1", set: "LOW_H", assignment: LOW_H_ASSIGNMENT }],
  ["another correct declaration", teamAGame, { type: "declare", player: "a1", set: "HIGH_S", assignment: HIGH_S_ASSIGNMENT }],
  ["a wrong declaration", teamAGame, { type: "declare", player: "a1", set: "LOW_H", assignment: { ...LOW_H_ASSIGNMENT, "2H": "a2" } }],
  ["a choose", choosing, { type: "choose", player: "a1", choice: "a2" }],
  ["a turn timeout", base, { type: "timeout" }],
  ["a choose timeout", choosing, { type: "timeout" }],
  ["a rejected ask", base, { type: "ask", player: "b1", target: "a1", card: "3H" }],
  ["a rejected declaration", teamAGame, { type: "declare", player: "a1", set: "LOW_H", assignment: {} }],
  ["a rejected choose", base, { type: "choose", player: "a1", choice: "a2" }],
];

describe("apply is pure", () => {
  it.each(cases)("leaves the input untouched for %s", (_name, make, action) => {
    const state = make();
    const before = snapshot(state);
    apply(state, action, rngOf(0.4));
    expect(snapshot(state)).toBe(before);
  });

  it.each(cases)("never writes to a frozen input for %s", (_name, make, action) => {
    const state = deepFreeze(make());
    expect(() => apply(state, action, rngOf(0.4))).not.toThrow();
  });

  it("returns a new state that shares no nested objects with the input", () => {
    const state = base();
    const result = run(state, { type: "ask", player: "a1", target: "b1", card: "5H" });
    expect(result.state).not.toBe(state);
    expect(result.state.hands).not.toBe(state.hands);
    expect(result.state.hands.b2).not.toBe(state.hands.b2);
    expect(result.state.sets).not.toBe(state.sets);
    expect(result.state.config).not.toBe(state.config);
  });

  it("does not let a later change to the result leak into the input", () => {
    const state = base();
    const before = snapshot(state);
    const { state: next } = run(state, { type: "ask", player: "a1", target: "b1", card: "5H" });
    next.hands.a1!.push("2C");
    next.scores.A = 99;
    expect(snapshot(state)).toBe(before);
  });
});
