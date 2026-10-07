import { describe, expect, it } from "vitest";
import type { Card, SetId } from "../src/index.js";
import { apply, playerView } from "../src/index.js";
import { canonical, codeOf, makeGame, mutate, run } from "./helpers.js";

// a1 (team A) is active. b1 holds 5H and QS, b2 holds 6H, b3 is out of cards.
const game = (historyLimit = 3) =>
  makeGame({
    historyLimit,
    hands: {
      a1: ["3H", "7H", "KC", "9S"],
      a2: ["2S"],
      b1: ["5H", "QS"],
      b2: ["6H"],
      b3: [],
    },
  });

const ask = (player: string, target: string, card: Card) => ({ type: "ask", player, target, card }) as const;
const unknownCard = "1X" as unknown as Card;

describe("ask: success", () => {
  it("moves the card, keeps the turn and records the transfer", () => {
    const before = game();
    const { state, events } = run(before, ask("a1", "b1", "5H"));
    expect(state.hands.a1).toEqual(["KC", "3H", "5H", "7H", "9S"]);
    expect(state.hands.b1).toEqual(["QS"]);
    expect(state.phase).toEqual({ kind: "turn", player: "a1" });
    expect(state.transferCount).toBe(1);
    expect(state.history).toEqual([{ seq: 1, from: "b1", to: "a1", card: "5H" }]);
    expect(events).toEqual([{ type: "askSucceeded", asker: "a1", target: "b1", card: "5H" }]);
  });

  it("keeps hands in canonical order after a transfer", () => {
    let state = game();
    state = run(state, ask("a1", "b2", "6H")).state;
    state = run(state, ask("a1", "b1", "QS")).state;
    for (const hand of Object.values(state.hands)) expect(hand).toEqual(canonical(hand));
  });

  it("keeps only the last historyLimit transfers, with increasing seq", () => {
    let state = game(2);
    state = run(state, ask("a1", "b1", "5H")).state;
    state = run(state, ask("a1", "b2", "6H")).state;
    state = run(state, ask("a1", "b1", "QS")).state;
    expect(state.transferCount).toBe(3);
    expect(state.history.map((t) => t.seq)).toEqual([2, 3]);
    expect(state.history.map((t) => t.card)).toEqual(["6H", "QS"]);
  });

  it("allows asking the same opponent again, or another one", () => {
    let state = game();
    state = run(state, ask("a1", "b1", "5H")).state;
    expect(apply(state, ask("a1", "b1", "QS")).ok).toBe(true);
    expect(apply(state, ask("a1", "b2", "6H")).ok).toBe(true);
  });
});

describe("ask: failure", () => {
  it("passes the turn and records the failed ask without a transfer", () => {
    const before = game();
    const { state, events } = run(before, ask("a1", "b2", "5H"));
    expect(state.phase).toEqual({ kind: "turn", player: "b2" });
    expect(state.hands).toEqual(before.hands);
    expect(state.history).toEqual([]);
    expect(state.transferCount).toBe(0);
    expect(playerView(state, "a1").recentAsks).toEqual([
      { seq: 1, asker: "a1", target: "b2", card: "5H", ok: false },
    ]);
    expect(events).toEqual([
      { type: "askFailed", asker: "a1", target: "b2", card: "5H" },
      { type: "turnChanged", player: "b2" },
    ]);
  });

  it("keeps the latest asks, including successes and failures, across restored state", () => {
    let state = makeGame({ hands: { a1: ["3H", "9S"], b1: ["5H", "QS", "2D"], b2: ["6H"] } });
    state = run(state, ask("a1", "b1", "5H")).state;
    state = run(state, ask("a1", "b2", "6H")).state;
    state = run(state, ask("a1", "b1", "QS")).state;
    state = JSON.parse(JSON.stringify(state));
    const before = JSON.stringify(state);
    const next = run(state, ask("a1", "b1", "JS")).state;
    expect(JSON.stringify(state)).toBe(before);
    expect(playerView(next, "b2").recentAsks).toEqual([
      { seq: 2, asker: "a1", target: "b2", card: "6H", ok: true },
      { seq: 3, asker: "a1", target: "b1", card: "QS", ok: true },
      { seq: 4, asker: "a1", target: "b1", card: "JS", ok: false },
    ]);
    expect(next.transferCount).toBe(3);
    expect(next.history.map((transfer) => transfer.seq)).toEqual([1, 2, 3]);
    const view = playerView(next, "a1");
    view.recentAsks[0]!.card = "2C";
    expect(playerView(next, "a1").recentAsks[0]!.card).toBe("6H");
  });
});

describe("ask: error codes", () => {
  const choosing = mutate(game(), (s) => {
    s.phase = { kind: "choose", chooser: { player: "a1" }, eligible: ["a1", "a2"], reason: "correctDeclaration" };
  });

  it.each<[string, () => string, string]>([
    ["WRONG_PHASE", () => codeOf(choosing, ask("a1", "b1", "5H")), "WRONG_PHASE"],
    ["UNKNOWN_PLAYER (asker)", () => codeOf(game(), ask("nobody", "b1", "5H")), "UNKNOWN_PLAYER"],
    ["NOT_YOUR_TURN", () => codeOf(game(), ask("b1", "a1", "3H")), "NOT_YOUR_TURN"],
    ["UNKNOWN_PLAYER (target)", () => codeOf(game(), ask("a1", "nobody", "5H")), "UNKNOWN_PLAYER"],
    ["UNKNOWN_CARD", () => codeOf(game(), ask("a1", "b1", unknownCard)), "UNKNOWN_CARD"],
    ["TARGET_NOT_OPPONENT", () => codeOf(game(), ask("a1", "a2", "5H")), "TARGET_NOT_OPPONENT"],
    ["TARGET_HAS_NO_CARDS", () => codeOf(game(), ask("a1", "b3", "5H")), "TARGET_HAS_NO_CARDS"],
    [
      "SET_NOT_ACTIVE",
      () => codeOf(mutate(game(), (s) => { s.sets.LOW_D = "WON_A"; }), ask("a1", "b1", "2D")),
      "SET_NOT_ACTIVE",
    ],
    ["ALREADY_HOLD_CARD", () => codeOf(game(), ask("a1", "b1", "3H")), "ALREADY_HOLD_CARD"],
    ["NO_BASE_CARD", () => codeOf(game(), ask("a1", "b1", "2C")), "NO_BASE_CARD"],
  ])("%s", (_name, code, expected) => {
    expect(code()).toBe(expected);
  });

  it("returns a readable message with the error", () => {
    const result = apply(game(), ask("a1", "a2", "5H"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/opponent/i);
  });

  describe("checks run in the documented order", () => {
    it("phase before player", () => {
      expect(codeOf(choosing, ask("nobody", "b1", "5H"))).toBe("WRONG_PHASE");
    });
    it("asker known before asker active", () => {
      expect(codeOf(game(), ask("nobody", "nobody", unknownCard))).toBe("UNKNOWN_PLAYER");
    });
    it("active player before target", () => {
      expect(codeOf(game(), ask("b1", "nobody", "5H"))).toBe("NOT_YOUR_TURN");
    });
    it("target known before card valid", () => {
      expect(codeOf(game(), ask("a1", "nobody", unknownCard))).toBe("UNKNOWN_PLAYER");
    });
    it("card valid before target is an opponent", () => {
      expect(codeOf(game(), ask("a1", "a2", unknownCard))).toBe("UNKNOWN_CARD");
    });
    it("opponent before target has cards", () => {
      const state = mutate(game(), (s) => { s.hands.a2 = []; });
      expect(codeOf(state, ask("a1", "a2", "5H"))).toBe("TARGET_NOT_OPPONENT");
    });
    it("target has cards before set active", () => {
      const state = mutate(game(), (s) => { s.sets.LOW_D = "NULL"; });
      expect(codeOf(state, ask("a1", "b3", "2D"))).toBe("TARGET_HAS_NO_CARDS");
    });
    it("set active before already-hold and base card", () => {
      const set: SetId = "LOW_D";
      const state = mutate(game(), (s) => { s.sets[set] = "WON_B"; });
      expect(codeOf(state, ask("a1", "b1", "2D"))).toBe("SET_NOT_ACTIVE");
    });
  });

  it("never changes the state on a rejection", () => {
    const state = game();
    const result = apply(state, ask("a1", "b3", "5H"));
    expect(result.ok).toBe(false);
    expect(state).toEqual(game());
  });
});
