import { describe, expect, it } from "vitest";
import { ALL_CARDS, playerView } from "../src/index.js";
import type { Engine } from "../src/index.js";
import { createGame, apply } from "../src/game.js";
import { LOW_H_ASSIGNMENT, canonical, clone, makeGame, mutate, run, seats, snapshot, teamAGame } from "./helpers.js";

// Hand sizes and other hands must never reach a client.
const game = () =>
  makeGame({ hands: { a1: ["3H", "7H", "KC"], a2: ["2S"], b1: ["5H", "QS"], b2: ["6H"], b3: [] } });

describe("playerView", () => {
  it("returns the player's own hand, sorted, and their team", () => {
    const view = playerView(game(), "a1");
    expect(view.me).toBe("a1");
    expect(view.myTeam).toBe("A");
    expect(view.hand).toEqual(["KC", "3H", "7H"]);
    expect(view.hand).toEqual(canonical(view.hand));
    expect(playerView(game(), "b1").myTeam).toBe("B");
  });

  it("lists players in seat order with only an outOfCards flag", () => {
    const view = playerView(game(), "a1");
    expect(view.players.map((p) => p.id)).toEqual(["a1", "b1", "a2", "b2", "a3", "b3"]);
    expect(view.players.map((p) => p.team)).toEqual(["A", "B", "A", "B", "A", "B"]);
    expect(view.players.map((p) => p.outOfCards)).toEqual([false, false, false, false, false, true]);
    for (const p of view.players) expect(Object.keys(p).sort()).toEqual(["id", "outOfCards", "team"]);
  });

  it("flags the viewer as out of cards when they hold none", () => {
    expect(playerView(game(), "b3").players.find((p) => p.id === "b3")?.outOfCards).toBe(true);
    expect(playerView(game(), "b3").hand).toEqual([]);
  });

  it("exposes sets, scores, phase, config, transfers and transferCount", () => {
    const state = run(game(), { type: "ask", player: "a1", target: "b1", card: "5H" }).state;
    const view = playerView(state, "b2");
    expect(view.sets).toEqual(state.sets);
    expect(view.scores).toEqual(state.scores);
    expect(view.phase).toEqual(state.phase);
    expect(view.config).toEqual(state.config);
    expect(view.recentTransfers).toEqual([{ seq: 1, from: "b1", to: "a1", card: "5H" }]);
    expect(view.transferCount).toBe(1);
  });

  it("exposes resolutions and the choose phase after a declaration", () => {
    const state = run(teamAGame(), { type: "declare", player: "a1", set: "LOW_H", assignment: LOW_H_ASSIGNMENT }).state;
    const view = playerView(state, "b2");
    expect(view.resolutions).toEqual(state.resolutions);
    expect(view.resolutions).toHaveLength(1);
    expect(view.scores).toEqual({ A: 1, B: 0 });
    expect(view.phase).toEqual(state.phase);
    expect(view.phase.kind).toBe("choose");
  });

  it("only includes the last historyLimit transfers", () => {
    let state = makeGame({ historyLimit: 1, hands: { a1: ["3H", "9S"], b1: ["5H", "QS"] } });
    state = run(state, { type: "ask", player: "a1", target: "b1", card: "5H" }).state;
    state = run(state, { type: "ask", player: "a1", target: "b1", card: "QS" }).state;
    const view = playerView(state, "a1");
    expect(view.recentTransfers).toEqual([{ seq: 2, from: "b1", to: "a1", card: "QS" }]);
    expect(view.transferCount).toBe(2);
  });

  it("has exactly the PlayerView keys and no hands or hand sizes", () => {
    const view = playerView(game(), "a1");
    expect(Object.keys(view).sort()).toEqual(
      ["config", "hand", "me", "myTeam", "phase", "players", "recentTransfers", "resolutions", "scores", "sets", "transferCount"].sort(),
    );
    expect(snapshot(view)).not.toMatch(/"hands"|handSize/);
  });

  it("never serializes a card from another player's hand", () => {
    const state = game();
    for (const viewer of state.players) {
      const json = snapshot(playerView(state, viewer.id));
      for (const other of state.players) {
        if (other.id === viewer.id) continue;
        for (const card of state.hands[other.id]!) {
          if (state.hands[viewer.id]!.includes(card)) continue;
          expect(json).not.toContain(`"${card}"`);
        }
      }
    }
  });

  it("leaks nothing across a whole random-looking deal", () => {
    const players = seats(8);
    const result = createGame({ players, config: { wrongDeclaration: "null", historyLimit: 3 }, rng: () => 0.3, firstPlayer: "a1" });
    if (!result.ok) throw new Error("setup failed");
    const state = result.state;
    for (const viewer of players) {
      const json = snapshot(playerView(state, viewer.id));
      const own = new Set(state.hands[viewer.id]);
      const leaked = ALL_CARDS.filter((c) => !own.has(c) && json.includes(`"${c}"`));
      expect(leaked).toEqual([]);
    }
  });

  it("shows only transfers as card information beyond the viewer's hand", () => {
    const state = run(game(), { type: "ask", player: "a1", target: "b1", card: "5H" }).state;
    const view = playerView(state, "b2");
    const json = snapshot(view);
    expect(json).toContain('"5H"'); // the transfer is public
    expect(json).not.toContain('"QS"'); // b1's remaining card is not
    expect(json).not.toContain('"KC"'); // neither is a1's
  });

  it("returns fresh objects so callers can't mutate state through the view", () => {
    const state = game();
    const before = snapshot(state);
    const view = playerView(state, "a1");
    view.hand.push("2C");
    view.sets.LOW_C = "NULL";
    view.scores.A = 9;
    view.players[0]!.outOfCards = true;
    view.config.historyLimit = 99;
    view.recentTransfers.push({ seq: 1, from: "a1", to: "b1", card: "2C" });
    view.resolutions.push({ set: "LOW_C", declaredBy: "a1", team: "A", correct: true, outcome: "WON_A" });
    if (view.phase.kind === "turn") view.phase.player = "b1";
    expect(snapshot(state)).toBe(before);
  });

  it("copies the choose phase's eligible list", () => {
    const state = mutate(game(), (s) => {
      s.phase = { kind: "choose", chooser: { team: "B" }, eligible: ["b1", "b2"], reason: "wrongDeclaration" };
    });
    const view = playerView(state, "a1");
    if (view.phase.kind !== "choose") throw new Error("expected choose phase");
    view.phase.eligible.push("a1");
    if (state.phase.kind === "choose") expect(state.phase.eligible).toEqual(["b1", "b2"]);
  });

  it("throws for an unknown player", () => {
    expect(() => playerView(game(), "nobody")).toThrow(Error);
  });

  it("works on a state restored from JSON", () => {
    const restored = clone(game());
    expect(playerView(restored, "a1").hand).toEqual(["KC", "3H", "7H"]);
  });
});

describe("Engine interface", () => {
  it("can be constructed from createGame, apply and playerView", () => {
    const engine: Engine = { createGame, apply, playerView };
    const result = engine.createGame({
      players: seats(6),
      config: { wrongDeclaration: "award", historyLimit: 3 },
      firstPlayer: "a1",
    });
    expect(result.ok).toBe(true);
  });
});
