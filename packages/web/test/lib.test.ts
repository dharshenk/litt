import { describe, expect, it, vi } from "vitest";
import { ALL_CARDS, SET_IDS, cardsInSet } from "@litt/engine";
import type { Card, GameEvent } from "@litt/engine";
import { apiUrl, getDevUser, loginUrl, setDevUser, wsUrl, DEV_NAME_PATTERN } from "../src/lib/api.js";
import { cardFace, cardLabel, setInfo, sortCards } from "../src/lib/cards.js";
import { playSound, setMuted } from "../src/lib/sound.js";
import { readStorage, writeStorage } from "../src/lib/storage.js";
import { declaredText, gameOverText, initials, joinNames, makeNamer, numberWord, timedOutText } from "../src/game/text.js";

const VS = "︎"; // text-presentation selector appended to suits

describe("cards", () => {
  it("describes suited cards, with red for hearts and diamonds", () => {
    expect(cardFace("5H")).toEqual({ rank: "5", suit: `♥${VS}`, red: true, label: `5♥${VS}` });
    expect(cardFace("10D")).toMatchObject({ rank: "10", red: true });
    expect(cardFace("KC")).toMatchObject({ rank: "K", red: false, label: `K♣${VS}` });
    expect(cardFace("AS")).toMatchObject({ red: false });
  });

  it("describes the jokers", () => {
    expect(cardFace("JK1")).toMatchObject({ rank: "JK", suit: "★", red: true, label: "Red Joker" });
    expect(cardFace("JK2")).toMatchObject({ red: false, label: "Black Joker" });
  });

  it("has a unique label for every card in the deck", () => {
    expect(new Set(ALL_CARDS.map(cardLabel)).size).toBe(54);
  });

  it("sorts cards into canonical deck order without mutating the input", () => {
    const hand: Card[] = ["AS", "2C", "JK1", "5H"];
    expect(sortCards(hand)).toEqual(["2C", "5H", "AS", "JK1"]);
    expect(hand).toEqual(["AS", "2C", "JK1", "5H"]);
  });

  it("names all nine sets", () => {
    expect(SET_IDS.map((s) => setInfo(s).full)).toEqual([
      `Low ♣${VS} (2–7)`,
      `Low ♦${VS} (2–7)`,
      `Low ♥${VS} (2–7)`,
      `Low ♠${VS} (2–7)`,
      `High ♣${VS} (9–A)`,
      `High ♦${VS} (9–A)`,
      `High ♥${VS} (9–A)`,
      `High ♠${VS} (9–A)`,
      "8s & Jokers",
    ]);
    expect(setInfo("EIGHTS")).toEqual({ name: "8s & J", full: "8s & Jokers", range: "8 · ★" });
    expect(setInfo("LOW_H").range).toBe("2–7");
    expect(setInfo("HIGH_S").range).toBe("9–A");
    expect(cardsInSet("EIGHTS")).toHaveLength(6);
  });
});

describe("text helpers", () => {
  const names = new Map([
    ["me", "dharshen"],
    ["maya", "Maya"],
  ]);
  const namer = makeNamer("me", names);

  it("names people relative to the viewer", () => {
    expect(namer.name("me")).toBe("You");
    expect(namer.name("maya")).toBe("Maya");
    expect(namer.obj("me")).toBe("you");
    expect(namer.obj("maya")).toBe("Maya");
    expect(namer.raw("me")).toBe("dharshen");
    expect(namer.turn("me")).toBe("Your turn");
    expect(namer.turn("maya")).toBe("Maya’s turn");
    expect(namer.name("stranger")).toBe("stranger");
  });

  it("makes initials", () => {
    expect(initials("dharshen")).toBe("DH");
    expect(initials("Maya Chen")).toBe("MC");
    expect(initials("a_b")).toBe("AB");
    expect(initials("x")).toBe("X");
    expect(initials("  ")).toBe("?");
  });

  it("joins names", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Eve"])).toBe("Eve");
    expect(joinNames(["Eve", "Frank"])).toBe("Eve and Frank");
    expect(joinNames(["a", "b", "c"])).toBe("a, b and c");
  });

  it("spells small numbers", () => {
    expect(numberWord(3)).toBe("three");
    expect(numberWord(6)).toBe("six");
    expect(numberWord(11)).toBe("11");
  });

  it("words declarations for humans", () => {
    const base = { type: "declared", player: "maya", team: "A", set: "LOW_H", assignment: {} } as const;
    const ev = (o: Partial<Extract<GameEvent, { type: "declared" }>>) => ({ ...base, correct: true, outcome: "WON_A", ...o }) as Extract<GameEvent, { type: "declared" }>;
    expect(declaredText(ev({}), namer)).toBe(`Maya declared Low ♥${VS} — correct. Team A +1`);
    expect(declaredText(ev({ player: "me" }), namer)).toBe(`You declared Low ♥${VS} — correct. Team A +1`);
    expect(declaredText(ev({ correct: false, outcome: "WON_B" }), namer)).toBe(`Maya declared Low ♥${VS} — wrong. Team B +1`);
    expect(declaredText(ev({ correct: false, outcome: "NULL" }), namer)).toBe(`Maya declared Low ♥${VS} — wrong. The set is nullified.`);
  });

  it("words timeouts by phase", () => {
    expect(timedOutText({ kind: "turn", player: "maya" }, namer)).toBe("Time’s up for Maya.");
    expect(timedOutText({ kind: "turn", player: "me" }, namer)).toBe("Time’s up for you.");
    expect(timedOutText({ kind: "choose", chooser: { team: "A" }, eligible: [], reason: "wrongDeclaration" }, namer)).toMatch(/random/);
    expect(timedOutText(null, namer)).toMatch(/random/);
  });

  it("words the end of the game", () => {
    expect(gameOverText({ type: "gameOver", result: "A", scores: { A: 5, B: 3 } })).toBe("Game over. Team A wins 5–3.");
    expect(gameOverText({ type: "gameOver", result: "B", scores: { A: 3, B: 6 } })).toBe("Game over. Team B wins 6–3.");
    expect(gameOverText({ type: "gameOver", result: "draw", scores: { A: 4, B: 4 } })).toBe("Game over. It’s a draw, 4–4.");
  });
});

describe("storage", () => {
  it("round-trips and removes values", () => {
    writeStorage("local", "k", "v");
    expect(readStorage("local", "k")).toBe("v");
    writeStorage("local", "k", null);
    expect(readStorage("local", "k")).toBeNull();
    writeStorage("session", "s", "1");
    expect(readStorage("session", "s")).toBe("1");
    expect(readStorage("local", "s")).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStorage("local", "k")).toBeNull();
    expect(() => writeStorage("local", "k", "v")).not.toThrow();
  });
});

describe("sound", () => {
  it("remembers the mute setting in localStorage", () => {
    setMuted(true);
    expect(readStorage("local", "litt_muted")).toBe("1");
    setMuted(false);
    expect(readStorage("local", "litt_muted")).toBeNull();
  });

  it("never throws without Web Audio, muted or not", () => {
    setMuted(false);
    expect(() => playSound("turn")).not.toThrow();
    setMuted(true);
    expect(() => playSound("tick")).not.toThrow();
    setMuted(false);
  });
});

describe("dev identity and URLs", () => {
  it("adds devUser to API and WebSocket URLs only when set", () => {
    expect(apiUrl("/api/me")).toBe("/api/me");
    setDevUser("alice");
    expect(getDevUser()).toBe("alice");
    expect(apiUrl("/api/me")).toBe("/api/me?devUser=alice");
    expect(apiUrl("/api/stats?x=1")).toBe("/api/stats?x=1&devUser=alice");
    expect(wsUrl("/ws/rooms/K7QX")).toBe(`ws://${window.location.host}/ws/rooms/K7QX?devUser=alice`);
    setDevUser(null);
    expect(getDevUser()).toBeNull();
    expect(wsUrl("/ws/rooms/K7QX")).toBe(`ws://${window.location.host}/ws/rooms/K7QX`);
  });

  it("encodes the dev name", () => {
    setDevUser("a b");
    expect(apiUrl("/api/me")).toBe("/api/me?devUser=a%20b");
  });

  it("builds a login URL that returns to the current page", () => {
    expect(loginUrl("/r/K7QX")).toBe("/auth/login?next=%2Fr%2FK7QX");
  });

  it("validates dev names like the server does", () => {
    for (const ok of ["a", "Alice_1", "x-y", "a".repeat(20)]) expect(DEV_NAME_PATTERN.test(ok)).toBe(true);
    for (const bad of ["", "has space", "a".repeat(21), "é", "a/b"]) expect(DEV_NAME_PATTERN.test(bad)).toBe(false);
  });
});
