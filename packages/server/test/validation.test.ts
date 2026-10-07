import type { ClientMessage, RoomConfig } from "@litt/protocol";
import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/validation.js";

const config: RoomConfig = { wrongDeclaration: "award", historyLimit: 3, turnSeconds: null };
const valid: ClientMessage[] = [
  { t: "lobby.setTeam", playerId: "alice", team: "A" },
  { t: "lobby.setTeam", playerId: "alice", team: "B" },
  { t: "lobby.setTeam", playerId: "alice", team: null },
  { t: "lobby.setConfig", config },
  { t: "lobby.start" },
  { t: "room.rematch" },
  { t: "game.ask", target: "bob", card: "10H" },
  { t: "game.declare", set: "EIGHTS", assignment: { "8C": "alice", JK1: "eve", JK2: "alice" } },
  { t: "game.declare", set: "LOW_H", assignment: {} },
  { t: "game.choose", player: "alice" },
  { t: "ping" },
];

describe("parseClientMessage", () => {
  it.each(valid)("accepts %j", (msg) => {
    expect(parseClientMessage(JSON.stringify(msg))).toEqual({ ok: true, msg });
  });

  it.each(valid)("rejects extra fields on %j", (msg) => {
    expect(parseClientMessage(JSON.stringify({ ...msg, extra: true })).ok).toBe(false);
  });

  it.each([
    { t: "lobby.setTeam", playerId: "alice" },
    { t: "lobby.setTeam", playerId: "alice", team: "C" },
    { t: "lobby.setConfig" },
    { t: "lobby.setConfig", config: { ...config, extra: 1 } },
    { t: "lobby.setConfig", config: { historyLimit: 3, turnSeconds: null } },
    { t: "lobby.start", player: "alice" },
    { t: "room.rematch", player: "alice" },
    { t: "game.ask", target: "bob", card: "1C" },
    { t: "game.ask", card: "2C" },
    { t: "game.ask", target: "bob" },
    { t: "game.declare", set: "LOW_X", assignment: {} },
    { t: "game.declare", set: "LOW_C" },
    { t: "game.declare", set: "LOW_C", assignment: { nope: "alice" } },
    { t: "game.declare", set: "LOW_C", assignment: { "2C": 1 } },
    { t: "game.choose" },
    { t: "game.choose", player: 1 },
    { t: "ping", payload: true },
    { t: "timeout" },
    {}, null, [], "ping", 1,
  ])("rejects %j", (msg) => {
    expect(parseClientMessage(JSON.stringify(msg)).ok).toBe(false);
  });

  it.each([
    { historyLimit: 0 }, { historyLimit: 11 }, { historyLimit: 1.5 },
    { turnSeconds: 14 }, { turnSeconds: 601 }, { turnSeconds: 15.5 },
    { wrongDeclaration: "other" }, { turnSeconds: "30" },
  ])("rejects config bounds %j", (changes) => {
    expect(parseClientMessage(JSON.stringify({ t: "lobby.setConfig", config: { ...config, ...changes } })).ok).toBe(false);
  });

  it.each([1, 10])("accepts history bound %s", (historyLimit) => {
    expect(parseClientMessage(JSON.stringify({ t: "lobby.setConfig", config: { ...config, historyLimit } })).ok).toBe(true);
  });

  it.each([null, 15, 600])("accepts timer bound %s", (turnSeconds) => {
    expect(parseClientMessage(JSON.stringify({ t: "lobby.setConfig", config: { ...config, wrongDeclaration: "null", turnSeconds } })).ok).toBe(true);
  });

  it("rejects bad JSON and oversized UTF-8 payloads", () => {
    expect(parseClientMessage("{bad").ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: "game.choose", player: "x".repeat(16384) }))).toEqual({ ok: false, error: "Message exceeds 16 KB" });
    expect(parseClientMessage(JSON.stringify({ t: "game.choose", player: "\u00e9".repeat(8192) }))).toEqual({ ok: false, error: "Message exceeds 16 KB" });
    const prefix = '{"t":"game.choose","player":"';
    const exact = prefix + "x".repeat(16384 - prefix.length - 2) + '"}';
    expect(parseClientMessage(exact).ok).toBe(true);
  });
});
