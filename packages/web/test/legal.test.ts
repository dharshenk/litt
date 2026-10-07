import { describe, expect, it } from "vitest";
import type { Card } from "@litt/engine";
import {
  askProblem,
  askTargets,
  askableCards,
  askableSets,
  assignableTeammates,
  canAsk,
  canDeclare,
  canIChoose,
  declarableSets,
  effectiveAssignment,
  heldSets,
  isMyTurn,
  lockedCards,
  opponents,
  teammates,
  unassignedCount,
} from "../src/game/legal.js";
import { makeView } from "./fixtures.js";

// Default hand: Low ♥ {3,7}, High ♣ {K}, and all six of High ♠.
const view = (o: Parameters<typeof makeView>[0] = {}) => makeView(o);

describe("turn and chooser", () => {
  it("isMyTurn is true only in my turn phase", () => {
    expect(isMyTurn(view())).toBe(true);
    expect(isMyTurn(view({ phase: { kind: "turn", player: "bob" } }))).toBe(false);
    expect(isMyTurn(view({ phase: { kind: "over", result: "A" } }))).toBe(false);
  });

  it("canIChoose covers a named chooser and a team chooser", () => {
    const choose = (chooser: { player: string } | { team: "A" | "B" }) =>
      view({ phase: { kind: "choose", chooser, eligible: ["me"], reason: "correctDeclaration" } });
    expect(canIChoose(choose({ player: "me" }))).toBe(true);
    expect(canIChoose(choose({ player: "maya" }))).toBe(false);
    expect(canIChoose(choose({ team: "A" }))).toBe(true);
    expect(canIChoose(choose({ team: "B" }))).toBe(false);
    expect(canIChoose(view())).toBe(false);
  });
});

describe("players", () => {
  it("splits opponents and teammates, in seat order", () => {
    expect(opponents(view()).map((p) => p.id)).toEqual(["bob", "priya", "frank"]);
    expect(teammates(view()).map((p) => p.id)).toEqual(["me", "maya", "eve"]);
  });
});

describe("sets I can ask from or declare", () => {
  it("heldSets lists active sets I hold at least one card of", () => {
    expect(heldSets(view())).toEqual(["LOW_H", "HIGH_C", "HIGH_S"]);
    expect(declarableSets(view())).toEqual(heldSets(view()));
  });

  it("heldSets ignores resolved sets", () => {
    expect(heldSets(view({ sets: { HIGH_S: "WON_A" } }))).toEqual(["LOW_H", "HIGH_C"]);
  });

  it("askableSets leaves out sets I already hold completely", () => {
    expect(askableSets(view())).toEqual(["LOW_H", "HIGH_C"]);
  });

  it("askableCards are the cards of an askable set that I don't hold", () => {
    expect(askableCards(view(), "LOW_H")).toEqual(["2H", "4H", "5H", "6H"]);
    expect(askableCards(view(), "HIGH_C")).toEqual(["9C", "10C", "JC", "QC", "AC"]);
  });

  it("askableCards is empty for sets I hold fully, don't hold, or are resolved", () => {
    expect(askableCards(view(), "HIGH_S")).toEqual([]);
    expect(askableCards(view(), "LOW_C")).toEqual([]);
    expect(askableCards(view({ sets: { LOW_H: "NULL" } }), "LOW_H")).toEqual([]);
  });

  it("with no hand there is nothing to ask or declare", () => {
    expect(heldSets(view({ hand: [] }))).toEqual([]);
    expect(askableSets(view({ hand: [] }))).toEqual([]);
  });
});

describe("askTargets", () => {
  it("lists opponents with cards only", () => {
    expect(askTargets(view())).toEqual(["bob", "priya", "frank"]);
    expect(askTargets(view({ out: ["priya"] }))).toEqual(["bob", "frank"]);
    expect(askTargets(view({ out: ["bob", "priya", "frank"] }))).toEqual([]);
  });

  it("never lists teammates, even with cards", () => {
    expect(askTargets(view())).not.toContain("maya");
  });
});

describe("askProblem / canAsk", () => {
  it("accepts a legal ask", () => {
    expect(askProblem(view(), "bob", "5H")).toBeNull();
    expect(canAsk(view(), "bob", "5H")).toBe(true);
  });

  it.each<[string, () => string | null, RegExp]>([
    ["not my turn", () => askProblem(view({ phase: { kind: "turn", player: "bob" } }), "priya", "5H"), /not your turn/i],
    ["unknown target", () => askProblem(view(), "nobody", "5H"), /not in this game/i],
    ["unknown card", () => askProblem(view(), "bob", "1X" as unknown as Card), /not a card/i],
    ["a teammate", () => askProblem(view(), "maya", "5H"), /opponent/i],
    ["an empty-handed opponent", () => askProblem(view({ out: ["bob"] }), "bob", "5H"), /no cards/i],
    ["a resolved set", () => askProblem(view({ sets: { LOW_D: "WON_B" } }), "bob", "2D"), /resolved/i],
    ["a card I hold", () => askProblem(view(), "bob", "3H"), /already hold/i],
    ["a set I don't hold", () => askProblem(view(), "bob", "2C"), /another card from that set/i],
  ])("rejects %s", (_name, problem, message) => {
    expect(problem()).toMatch(message);
  });

  it("reports problems in the engine's check order", () => {
    expect(askProblem(view({ phase: { kind: "turn", player: "bob" } }), "nobody", "1X" as unknown as Card)).toMatch(
      /not your turn/i,
    );
    expect(askProblem(view(), "maya", "1X" as unknown as Card)).toMatch(/not a card/i);
    expect(askProblem(view({ out: ["maya"] }), "maya", "5H")).toMatch(/opponent/i);
    expect(askProblem(view({ out: ["bob"], sets: { LOW_D: "NULL" } }), "bob", "2D")).toMatch(/no cards/i);
  });
});

describe("declaring", () => {
  it("lockedCards are the cards of the set that I hold", () => {
    expect(lockedCards(view(), "LOW_H")).toEqual(["3H", "7H"]);
    expect(lockedCards(view(), "LOW_C")).toEqual([]);
  });

  it("assignableTeammates always includes me, and teammates who still hold cards", () => {
    expect(assignableTeammates(view())).toEqual(["me", "maya", "eve"]);
    expect(assignableTeammates(view({ out: ["maya"] }))).toEqual(["me", "eve"]);
    expect(assignableTeammates(view({ hand: [] }))).toEqual(["me", "maya", "eve"]);
  });

  it("effectiveAssignment prefills my own cards and keeps valid picks", () => {
    expect(effectiveAssignment(view(), "LOW_H", { "2H": "maya", "4H": "eve" })).toEqual({
      "2H": "maya",
      "3H": "me",
      "4H": "eve",
      "7H": "me",
    });
  });

  it("effectiveAssignment overrides picks for my own cards, and drops invalid picks", () => {
    const picks = {
      "3H": "maya", // mine: forced to me
      "2H": "bob", // opponent
      "4H": "nobody", // unknown
      "5H": "maya", // fine
      "9S": "eve", // not in this set
    };
    expect(effectiveAssignment(view(), "LOW_H", picks)).toEqual({ "3H": "me", "7H": "me", "5H": "maya" });
  });

  it("effectiveAssignment drops picks of an out-of-cards teammate", () => {
    expect(effectiveAssignment(view({ out: ["maya"] }), "LOW_H", { "2H": "maya" })).toEqual({ "3H": "me", "7H": "me" });
  });

  it("unassignedCount counts the cards still to place", () => {
    expect(unassignedCount(view(), "LOW_H", {})).toBe(4);
    expect(unassignedCount(view(), "LOW_H", { "2H": "maya", "4H": "maya" })).toBe(2);
    expect(unassignedCount(view(), "HIGH_S", {})).toBe(0);
  });

  it("canDeclare needs my turn, a held set and a full assignment", () => {
    const full = { "2H": "maya", "4H": "maya", "5H": "eve", "6H": "eve" };
    expect(canDeclare(view(), "LOW_H", full)).toBe(true);
    expect(canDeclare(view(), "LOW_H", { "2H": "maya" })).toBe(false);
    expect(canDeclare(view(), "HIGH_S", {})).toBe(true); // all mine already
    expect(canDeclare(view(), "LOW_C", {})).toBe(false); // not held
    expect(canDeclare(view({ sets: { LOW_H: "WON_B" } }), "LOW_H", full)).toBe(false);
    expect(canDeclare(view({ phase: { kind: "turn", player: "bob" } }), "LOW_H", full)).toBe(false);
  });
});
