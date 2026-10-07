import { describe, expect, it } from "vitest";
import { cardsInSet, setOf } from "../src/index.js";
import type { Assignment, Card, SetId } from "../src/index.js";
import {
  HIGH_S_ASSIGNMENT,
  LOW_H_ASSIGNMENT,
  codeOf,
  makeGame,
  mutate,
  run,
  teamAGame,
} from "./helpers.js";

const declare = (player: string, set: SetId, assignment: Assignment) =>
  ({ type: "declare", player, set, assignment }) as const;

/** Like teamAGame, but b1 holds 7H, so a1's LOW_H_ASSIGNMENT is wrong. */
const wrongGame = (mode: "award" | "null" = "award") =>
  teamAGame({ mode, hands: { a3: ["6H", "JS", "AS"], b1: ["7H"] } });

const noCardsOf = (hands: Record<string, Card[]>, set: SetId) =>
  Object.values(hands).every((h) => h.every((c) => setOf(c) !== set));

describe("declare: correct", () => {
  it("awards the set and a point to the declarer's team", () => {
    const { state, events } = run(teamAGame(), declare("a1", "LOW_H", LOW_H_ASSIGNMENT));
    expect(state.sets.LOW_H).toBe("WON_A");
    expect(state.scores).toEqual({ A: 1, B: 0 });
    expect(state.resolutions).toEqual([
      { set: "LOW_H", declaredBy: "a1", team: "A", correct: true, outcome: "WON_A" },
    ]);
    expect(events[0]).toEqual({
      type: "declared",
      player: "a1",
      team: "A",
      set: "LOW_H",
      assignment: LOW_H_ASSIGNMENT,
      correct: true,
      outcome: "WON_A",
    });
  });

  it("scores for team B when team B declares", () => {
    const state = makeGame({
      first: "b1",
      hands: { b1: ["2H", "3H", "9S"], b2: ["4H", "5H"], b3: ["6H", "7H"] },
    });
    const { state: next } = run(state, declare("b1", "LOW_H", { "2H": "b1", "3H": "b1", "4H": "b2", "5H": "b2", "6H": "b3", "7H": "b3" }));
    expect(next.sets.LOW_H).toBe("WON_B");
    expect(next.scores).toEqual({ A: 0, B: 1 });
  });

  it("removes all six cards from every hand", () => {
    const { state } = run(teamAGame(), declare("a1", "LOW_H", LOW_H_ASSIGNMENT));
    expect(noCardsOf(state.hands, "LOW_H")).toBe(true);
    expect(Object.values(state.hands).flat()).toHaveLength(48);
  });

  it("lets the declarer include themselves in the assignment", () => {
    const { state } = run(teamAGame(), declare("a1", "HIGH_S", HIGH_S_ASSIGNMENT));
    expect(state.sets.HIGH_S).toBe("WON_A");
  });
});

describe("declare: wrong", () => {
  it("award mode: the other team wins the set and scores", () => {
    const { state, events } = run(wrongGame("award"), declare("a1", "LOW_H", LOW_H_ASSIGNMENT));
    expect(state.sets.LOW_H).toBe("WON_B");
    expect(state.scores).toEqual({ A: 0, B: 1 });
    expect(state.resolutions).toEqual([
      { set: "LOW_H", declaredBy: "a1", team: "A", correct: false, outcome: "WON_B" },
    ]);
    expect(events[0]).toMatchObject({ type: "declared", correct: false, outcome: "WON_B", team: "A" });
  });

  it("null mode: the set is nullified and nobody scores", () => {
    const { state, events } = run(wrongGame("null"), declare("a1", "LOW_H", LOW_H_ASSIGNMENT));
    expect(state.sets.LOW_H).toBe("NULL");
    expect(state.scores).toEqual({ A: 0, B: 0 });
    expect(events[0]).toMatchObject({ type: "declared", correct: false, outcome: "NULL" });
  });

  it("removes the cards from both teams' hands", () => {
    for (const mode of ["award", "null"] as const) {
      const { state } = run(wrongGame(mode), declare("a1", "LOW_H", LOW_H_ASSIGNMENT));
      expect(noCardsOf(state.hands, "LOW_H")).toBe(true);
      expect(state.hands.b1).not.toContain("7H");
    }
  });

  it("is wrong if even one card is assigned to the wrong teammate", () => {
    const swapped = { ...LOW_H_ASSIGNMENT, "2H": "a2" };
    const { state } = run(teamAGame({ mode: "null" }), declare("a1", "LOW_H", swapped));
    expect(state.sets.LOW_H).toBe("NULL");
  });

  it("is wrong when a card is assigned to an empty-handed teammate", () => {
    const state = teamAGame({ mode: "null", hands: { a3: [], b1: ["6H", "7H"] } });
    const { state: next } = run(state, declare("a1", "LOW_H", LOW_H_ASSIGNMENT));
    expect(next.sets.LOW_H).toBe("NULL");
  });
});

describe("declare: bookkeeping", () => {
  it("does not touch history or transferCount", () => {
    const state = mutate(teamAGame(), (s) => {
      s.history = [{ seq: 5, from: "b1", to: "a1", card: "KC" }];
      s.transferCount = 5;
    });
    const { state: next } = run(state, declare("a1", "LOW_H", LOW_H_ASSIGNMENT));
    expect(next.history).toEqual(state.history);
    expect(next.transferCount).toBe(5);
  });

  it("records every declaration in order", () => {
    let state = teamAGame();
    state = run(state, declare("a1", "LOW_H", LOW_H_ASSIGNMENT)).state;
    state = run(state, { type: "choose", player: "a1", choice: "a2" }).state;
    state = run(state, declare("a2", "HIGH_S", HIGH_S_ASSIGNMENT)).state;
    expect(state.resolutions.map((r) => [r.set, r.declaredBy])).toEqual([
      ["LOW_H", "a1"],
      ["HIGH_S", "a2"],
    ]);
    expect(state.scores).toEqual({ A: 2, B: 0 });
  });
});

describe("declare: error codes", () => {
  const choosing = mutate(teamAGame(), (s) => {
    s.phase = { kind: "choose", chooser: { player: "a1" }, eligible: ["a1", "a2"], reason: "correctDeclaration" };
  });

  it("WRONG_PHASE outside a turn", () => {
    expect(codeOf(choosing, declare("a1", "LOW_H", LOW_H_ASSIGNMENT))).toBe("WRONG_PHASE");
  });

  it("UNKNOWN_PLAYER and NOT_YOUR_TURN", () => {
    expect(codeOf(teamAGame(), declare("nobody", "LOW_H", LOW_H_ASSIGNMENT))).toBe("UNKNOWN_PLAYER");
    expect(codeOf(teamAGame(), declare("a2", "LOW_H", LOW_H_ASSIGNMENT))).toBe("NOT_YOUR_TURN");
  });

  it("UNKNOWN_SET for an invalid set id", () => {
    expect(codeOf(teamAGame(), declare("a1", "NOPE" as SetId, LOW_H_ASSIGNMENT))).toBe("UNKNOWN_SET");
  });

  it("SET_NOT_ACTIVE for a resolved set", () => {
    const state = mutate(teamAGame(), (s) => { s.sets.LOW_H = "WON_B"; });
    expect(codeOf(state, declare("a1", "LOW_H", LOW_H_ASSIGNMENT))).toBe("SET_NOT_ACTIVE");
  });

  it("NO_BASE_CARD when the declarer holds nothing from the set", () => {
    expect(codeOf(teamAGame(), declare("a1", "HIGH_D", {}))).toBe("NO_BASE_CARD");
  });

  it("checks the base card before the assignment", () => {
    const bogus = { "9D": "b1" };
    expect(codeOf(teamAGame(), declare("a1", "HIGH_D", bogus))).toBe("NO_BASE_CARD");
  });

  describe("INVALID_ASSIGNMENT", () => {
    const { "7H": _dropped, ...missing } = LOW_H_ASSIGNMENT;
    it.each<[string, Assignment]>([
      ["a missing card", missing],
      ["an extra card from another set", { ...LOW_H_ASSIGNMENT, "9S": "a1" }],
      ["a card from another set instead of one of the six", { ...missing, "9S": "a1" }],
      ["an opponent", { ...LOW_H_ASSIGNMENT, "7H": "b1" }],
      ["an unknown player", { ...LOW_H_ASSIGNMENT, "7H": "nobody" }],
      ["an empty assignment", {}],
    ])("rejects %s", (_name, assignment) => {
      expect(codeOf(teamAGame(), declare("a1", "LOW_H", assignment))).toBe("INVALID_ASSIGNMENT");
    });

    it("rejects without changing the state or scoring a wrong declaration", () => {
      const state = teamAGame();
      expect(codeOf(state, declare("a1", "LOW_H", { ...LOW_H_ASSIGNMENT, "7H": "b1" }))).toBe("INVALID_ASSIGNMENT");
      expect(state.sets.LOW_H).toBe("ACTIVE");
      expect(state.scores).toEqual({ A: 0, B: 0 });
    });
  });

  it("covers every card in a set", () => {
    expect(cardsInSet("LOW_H")).toHaveLength(6);
    expect(Object.keys(LOW_H_ASSIGNMENT).sort()).toEqual([...cardsInSet("LOW_H")].sort());
  });
});
