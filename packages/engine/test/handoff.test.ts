import { describe, expect, it } from "vitest";
import type { Assignment, GameState, SetId } from "../src/index.js";
import { LOW_H_ASSIGNMENT, codeOf, makeGame, mutate, run, teamAGame } from "./helpers.js";

const declare = (player: string, set: SetId, assignment: Assignment) =>
  ({ type: "declare", player, set, assignment }) as const;
const choose = (player: string, choice: string) => ({ type: "choose", player, choice }) as const;

const declared = (state: GameState, player = "a1", assignment: Assignment = LOW_H_ASSIGNMENT) =>
  run(state, declare(player, "LOW_H", assignment));

describe("hand-off after a declaration", () => {
  it("correct, declarer's team has cards: the declarer chooses among teammates, including themselves", () => {
    const { state, events } = declared(teamAGame());
    expect(state.phase).toEqual({
      kind: "choose",
      chooser: { player: "a1" },
      eligible: ["a1", "a2", "a3"],
      reason: "correctDeclaration",
    });
    expect(events.map((e) => e.type)).toEqual(["declared", "chooseRequired"]);
    expect(events[1]).toEqual({
      type: "chooseRequired",
      chooser: { player: "a1" },
      eligible: ["a1", "a2", "a3"],
      reason: "correctDeclaration",
    });
  });

  it("correct, but the declarer's team is now empty: the opponents choose", () => {
    const state = makeGame({
      hands: { a1: ["2H", "3H"], a2: ["4H", "5H"], a3: ["6H", "7H"] },
    });
    const { state: next, events } = declared(state);
    expect(next.phase).toEqual({
      kind: "choose",
      chooser: { team: "B" },
      eligible: ["b1", "b2", "b3"],
      reason: "declarerTeamEmpty",
    });
    expect(events.map((e) => e.type)).toEqual(["declared", "chooseRequired"]);
  });

  it("wrong, opponents still have cards: the opposing team chooses among those with cards", () => {
    // b1 held only 7H, so b1 is empty once the set is removed and is not eligible.
    const { state, events } = declared(teamAGame({ hands: { a3: ["6H", "JS", "AS"], b1: ["7H"] } }));
    expect(state.phase).toEqual({
      kind: "choose",
      chooser: { team: "B" },
      eligible: ["b2", "b3"],
      reason: "wrongDeclaration",
    });
    expect(events.map((e) => e.type)).toEqual(["declared", "chooseRequired"]);
  });

  it("wrong, but the opponents have no cards: the declaring team chooses", () => {
    const state = makeGame({
      hands: { a1: ["2H", "3H", "9S"], a2: ["4H", "5H", "10S"], b1: [], b2: [], b3: [] },
    });
    // a3 holds 6H and 7H, so assigning 7H to a2 is wrong.
    const { state: next } = declared(state, "a1", { ...LOW_H_ASSIGNMENT, "7H": "a2" });
    expect(next.sets.LOW_H).toBe("WON_B");
    expect(next.phase).toEqual({
      kind: "choose",
      chooser: { team: "A" },
      eligible: ["a1", "a2", "a3"],
      reason: "opponentsEmpty",
    });
  });

  it("lists only players who hold at least one card, in seat order", () => {
    // a2 is empty-handed from the start; a1 and a3 keep a card after the set is removed.
    const state = makeGame({
      hands: { a1: ["2H", "3H", "9S"], a2: [], a3: ["4H", "5H", "6H", "7H", "JS"] },
    });
    const { state: next } = declared(state, "a1", { ...LOW_H_ASSIGNMENT, "4H": "a3", "5H": "a3", "6H": "a3", "7H": "a3" });
    expect(next.sets.LOW_H).toBe("WON_A");
    expect(next.phase).toMatchObject({ kind: "choose", eligible: ["a1", "a3"] });
  });

  describe("a single eligible player skips the choose phase", () => {
    it("after a correct declaration", () => {
      const state = makeGame({
        hands: { a1: ["2H", "3H", "4H", "5H", "6H", "7H", "9S"], a2: [], a3: [] },
      });
      const all: Assignment = Object.fromEntries(Object.keys(LOW_H_ASSIGNMENT).map((c) => [c, "a1"]));
      const { state: next, events } = declared(state, "a1", all);
      expect(next.phase).toEqual({ kind: "turn", player: "a1" });
      expect(events.map((e) => e.type)).toEqual(["declared", "turnChanged"]);
      expect(events[1]).toEqual({ type: "turnChanged", player: "a1" });
    });

    it("after a wrong declaration", () => {
      const state = makeGame({
        hands: { a1: ["2H", "3H", "9S"], a2: ["4H", "5H"], a3: ["6H"], b2: [], b3: [] },
      });
      // b1 holds 7H and everything else; b2 and b3 are empty.
      const { state: next, events } = declared(state);
      expect(next.phase).toEqual({ kind: "turn", player: "b1" });
      expect(events.map((e) => e.type)).toEqual(["declared", "turnChanged"]);
    });
  });
});

describe("choose", () => {
  const afterCorrect = () => declared(teamAGame()).state;
  const afterWrong = () => declared(teamAGame({ hands: { a3: ["6H", "JS", "AS"], b1: ["7H"] } })).state;

  it("gives the turn to the chosen player", () => {
    const { state, events } = run(afterCorrect(), choose("a1", "a3"));
    expect(state.phase).toEqual({ kind: "turn", player: "a3" });
    expect(events).toEqual([{ type: "turnChanged", player: "a3" }]);
  });

  it("lets the declarer choose themselves", () => {
    expect(run(afterCorrect(), choose("a1", "a1")).state.phase).toEqual({ kind: "turn", player: "a1" });
  });

  it("lets any member of the choosing team choose", () => {
    for (const member of ["b1", "b2", "b3"]) {
      const { state } = run(afterWrong(), choose(member, "b3"));
      expect(state.phase).toEqual({ kind: "turn", player: "b3" });
    }
  });

  it("WRONG_PHASE outside a choose phase", () => {
    expect(codeOf(teamAGame(), choose("a1", "a2"))).toBe("WRONG_PHASE");
  });

  it("UNKNOWN_PLAYER for someone not in the game", () => {
    expect(codeOf(afterCorrect(), choose("nobody", "a2"))).toBe("UNKNOWN_PLAYER");
  });

  describe("NOT_CHOOSER", () => {
    it("for a named chooser, rejects teammates and opponents", () => {
      expect(codeOf(afterCorrect(), choose("a2", "a2"))).toBe("NOT_CHOOSER");
      expect(codeOf(afterCorrect(), choose("b1", "a2"))).toBe("NOT_CHOOSER");
    });
    it("for a team chooser, rejects members of the other team", () => {
      expect(codeOf(afterWrong(), choose("a1", "b2"))).toBe("NOT_CHOOSER");
      expect(codeOf(afterWrong(), choose("a2", "b2"))).toBe("NOT_CHOOSER");
    });
  });

  describe("NOT_ELIGIBLE", () => {
    it("rejects a player outside the eligible list", () => {
      expect(codeOf(afterCorrect(), choose("a1", "b1"))).toBe("NOT_ELIGIBLE");
      expect(codeOf(afterCorrect(), choose("a1", "nobody"))).toBe("NOT_ELIGIBLE");
    });
    it("rejects an empty-handed teammate", () => {
      // b1 is empty after the wrong declaration, so b1 is not eligible.
      expect(codeOf(afterWrong(), choose("b2", "b1"))).toBe("NOT_ELIGIBLE");
    });
    it("checks the chooser before the choice", () => {
      expect(codeOf(afterCorrect(), choose("b1", "nobody"))).toBe("NOT_CHOOSER");
    });
  });

  it("does not let a stale choose through after the turn has started", () => {
    const turnState = mutate(afterCorrect(), (s) => { s.phase = { kind: "turn", player: "a1" }; });
    expect(codeOf(turnState, choose("a1", "a2"))).toBe("WRONG_PHASE");
  });
});
