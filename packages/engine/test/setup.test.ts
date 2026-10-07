import { describe, expect, it } from "vitest";
import { ALL_CARDS, createGame, seededRng, SET_IDS } from "../src/index.js";
import type { Card, CreateGameOptions, PlayerSeat } from "../src/index.js";
import { canonical, seats } from "./helpers.js";

const config = { wrongDeclaration: "award", historyLimit: 3 } as const;
const create = (o: Partial<CreateGameOptions> = {}) => createGame({ players: seats(6), config, ...o });

/** A valid deal: ALL_CARDS split round-robin. */
function roundRobin(players: PlayerSeat[]): Record<string, Card[]> {
  const deal: Record<string, Card[]> = Object.fromEntries(players.map((p) => [p.id, [] as Card[]]));
  ALL_CARDS.forEach((c, i) => deal[players[i % players.length]!.id]!.push(c));
  return deal;
}

describe("createGame: INVALID_SETUP", () => {
  const six = seats(6);
  const cases: [string, Partial<CreateGameOptions>][] = [
    ["fewer than 6 players", { players: seats(4) }],
    ["an odd number of players", { players: [...six, { id: "x1", team: "A" }] }],
    ["unequal teams", { players: six.map((p, i) => ({ ...p, team: i < 4 ? "A" : "B" })) }],
    ["duplicate player ids", { players: six.map((p, i) => (i === 5 ? { ...p, id: "a1" } : p)) }],
    ["historyLimit 0", { config: { ...config, historyLimit: 0 } }],
    ["a fractional historyLimit", { config: { ...config, historyLimit: 1.5 } }],
    ["a NaN historyLimit", { config: { ...config, historyLimit: Number.NaN } }],
    ["an unknown wrongDeclaration mode", { config: { ...config, wrongDeclaration: "other" as "award" } }],
    ["an unknown firstPlayer", { firstPlayer: "nobody" }],
    ["a deal missing a player", { deal: (({ b3: _b3, ...rest }) => rest)(roundRobin(six)) }],
    ["a deal with an extra player", { deal: { ...roundRobin(six), x1: [] } }],
    [
      "a deal with a duplicated card",
      {
        deal: (() => {
          const d = roundRobin(six);
          d.a1 = [...d.a1!.slice(1), d.b1![0]!];
          return d;
        })(),
      },
    ],
    [
      "a deal missing a card",
      {
        deal: (() => {
          const d = roundRobin(six);
          d.a1 = d.a1!.slice(1);
          return d;
        })(),
      },
    ],
    [
      "a deal with an unknown card",
      {
        deal: (() => {
          const d = roundRobin(six);
          d.a1 = [...d.a1!.slice(1), "1X" as unknown as Card];
          return d;
        })(),
      },
    ],
  ];

  it.each(cases)("rejects %s", (_name, options) => {
    const result = create(options);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_SETUP");
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  it("accepts a valid setup", () => {
    expect(create().ok).toBe(true);
    expect(create({ deal: roundRobin(six), firstPlayer: "b2" }).ok).toBe(true);
  });
});

describe("createGame: dealing", () => {
  it.each([6, 8, 10, 12])("deals all 54 cards as evenly as possible to %i players", (n) => {
    const players = seats(n);
    const result = create({ players, rng: seededRng(n) });
    if (!result.ok) throw new Error("setup failed");
    const sizes = players.map((p) => result.state.hands[p.id]!.length);
    const base = Math.floor(54 / n);
    const extra = 54 % n;
    // The first 54 % n seats get one extra card.
    expect(sizes).toEqual(players.map((_, i) => base + (i < extra ? 1 : 0)));
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(54);
  });

  it("gives 8 players six hands of 7 and two of 6", () => {
    const result = create({ players: seats(8), rng: seededRng(1) });
    if (!result.ok) throw new Error("setup failed");
    const sizes = Object.values(result.state.hands).map((h) => h.length);
    expect(sizes.filter((s) => s === 7)).toHaveLength(6);
    expect(sizes.filter((s) => s === 6)).toHaveLength(2);
  });

  it("deals every card exactly once, with hands in canonical order", () => {
    const result = create({ rng: seededRng(42) });
    if (!result.ok) throw new Error("setup failed");
    const all = Object.values(result.state.hands).flat();
    expect(all).toHaveLength(54);
    expect(new Set(all).size).toBe(54);
    expect(canonical(all)).toEqual([...ALL_CARDS]);
    for (const hand of Object.values(result.state.hands)) expect(hand).toEqual(canonical(hand));
  });

  it("deals round-robin starting from seat 0 (identity shuffle)", () => {
    const players = seats(6);
    // A constant rng just under 1 makes every Fisher–Yates swap a no-op.
    const result = create({ players, rng: () => 0.9999999 });
    if (!result.ok) throw new Error("setup failed");
    players.forEach((p, seat) => {
      expect(result.state.hands[p.id]).toEqual(ALL_CARDS.filter((_, i) => i % 6 === seat));
    });
  });

  it("shuffles deterministically under a seed, and differently across seeds", () => {
    const a = create({ rng: seededRng(7) });
    const b = create({ rng: seededRng(7) });
    const c = create({ rng: seededRng(8) });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("sorts hands from a fixed deal into canonical order", () => {
    const deal = roundRobin(seats(6));
    deal.a1 = [...deal.a1!].reverse();
    const result = create({ deal });
    if (!result.ok) throw new Error("setup failed");
    expect(result.state.hands.a1).toEqual(canonical(deal.a1));
  });
});

describe("createGame: initial state", () => {
  it("starts with every set active, zero scores and empty history", () => {
    const result = create({ rng: seededRng(3), firstPlayer: "b1" });
    if (!result.ok) throw new Error("setup failed");
    const { state } = result;
    expect(SET_IDS.every((s) => state.sets[s] === "ACTIVE")).toBe(true);
    expect(state.scores).toEqual({ A: 0, B: 0 });
    expect(state.history).toEqual([]);
    expect(state.resolutions).toEqual([]);
    expect(state.transferCount).toBe(0);
    expect(state.config).toEqual(config);
    expect(state.phase).toEqual({ kind: "turn", player: "b1" });
  });

  it("picks a random first player from the table using the rng", () => {
    const ids = seats(6).map((p) => p.id);
    const first = create({ rng: seededRng(5) });
    const again = create({ rng: seededRng(5) });
    if (!first.ok || !again.ok) throw new Error("setup failed");
    expect(first.state.phase.kind).toBe("turn");
    if (first.state.phase.kind === "turn") expect(ids).toContain(first.state.phase.player);
    expect(first.state.phase).toEqual(again.state.phase);
  });

  it("does not reorder players", () => {
    const players: PlayerSeat[] = [
      { id: "z", team: "B" },
      { id: "y", team: "A" },
      { id: "x", team: "A" },
      { id: "w", team: "B" },
      { id: "v", team: "A" },
      { id: "u", team: "B" },
    ];
    const result = create({ players });
    if (!result.ok) throw new Error("setup failed");
    expect(result.state.players.map((p) => p.id)).toEqual(["z", "y", "x", "w", "v", "u"]);
  });
});
