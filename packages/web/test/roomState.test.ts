import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@litt/protocol";
import { initialRoomState, roomReducer, type RoomClientState } from "../src/net/roomState.js";
import { makeRoom, makeView } from "./fixtures.js";

const msg = (state: RoomClientState, m: ServerMessage) => roomReducer(state, { type: "message", msg: m });

describe("roomReducer: messages", () => {
  it("room.state stores the room", () => {
    const room = makeRoom({ status: "lobby" });
    const next = msg(initialRoomState, { t: "room.state", room });
    expect(next.room).toBe(room);
  });

  it("room.state keeps the view while a game is on", () => {
    const view = makeView();
    let s = msg(initialRoomState, { t: "game.view", view, turnDeadline: 123 });
    s = msg(s, { t: "room.state", room: makeRoom({ status: "playing" }) });
    expect(s.view).toBe(view);
    expect(s.turnDeadline).toBe(123);
    s = msg(s, { t: "room.state", room: makeRoom({ status: "finished" }) });
    expect(s.view).toBe(view);
  });

  it("room.state back in the lobby (rematch) drops the old view and deadline", () => {
    let s = msg(initialRoomState, { t: "game.view", view: makeView(), turnDeadline: 123 });
    s = msg(s, { t: "room.state", room: makeRoom({ status: "lobby" }) });
    expect(s.view).toBeNull();
    expect(s.turnDeadline).toBeNull();
  });

  it("game.view stores the view and the turn deadline", () => {
    const view = makeView();
    expect(msg(initialRoomState, { t: "game.view", view, turnDeadline: 99 })).toMatchObject({ view, turnDeadline: 99 });
    expect(msg(initialRoomState, { t: "game.view", view, turnDeadline: null }).turnDeadline).toBeNull();
  });

  it("game.event queues events with increasing ids and the phase they arrived in", () => {
    const view = makeView({ phase: { kind: "turn", player: "bob" } });
    let s = msg(initialRoomState, { t: "game.view", view, turnDeadline: null });
    s = msg(s, { t: "game.event", event: { type: "timedOut", phase: "turn" } });
    s = msg(s, { t: "game.event", event: { type: "turnChanged", player: "priya" } });
    expect(s.events.map((e) => [e.id, e.event.type])).toEqual([
      [1, "timedOut"],
      [2, "turnChanged"],
    ]);
    expect(s.events[0]!.phaseBefore).toEqual({ kind: "turn", player: "bob" });
  });

  it("game.event before any view has no phaseBefore", () => {
    const s = msg(initialRoomState, { t: "game.event", event: { type: "turnChanged", player: "me" } });
    expect(s.events[0]!.phaseBefore).toBeNull();
  });

  it("keeps at most 50 queued events, dropping the oldest", () => {
    let s = initialRoomState;
    for (let i = 0; i < 60; i++) s = msg(s, { t: "game.event", event: { type: "turnChanged", player: "me" } });
    expect(s.events).toHaveLength(50);
    expect(s.events[0]!.id).toBe(11);
    expect(s.events[49]!.id).toBe(60);
  });

  it("error stores the last error with a fresh id each time", () => {
    let s = msg(initialRoomState, { t: "error", code: "NOT_YOUR_TURN", message: "It's not your turn." });
    expect(s.lastError).toEqual({ id: 1, code: "NOT_YOUR_TURN", message: "It's not your turn." });
    s = msg(s, { t: "error", code: "NOT_YOUR_TURN", message: "It's not your turn." });
    expect(s.lastError?.id).toBe(2);
  });

  it("pong changes nothing", () => {
    expect(msg(initialRoomState, { t: "pong" })).toBe(initialRoomState);
  });

  it("eventsHandled removes events up to the given id", () => {
    let s = initialRoomState;
    for (let i = 0; i < 3; i++) s = msg(s, { t: "game.event", event: { type: "turnChanged", player: "me" } });
    s = roomReducer(s, { type: "eventsHandled", upTo: 2 });
    expect(s.events.map((e) => e.id)).toEqual([3]);
  });
});

describe("roomReducer: connection status and reconnects", () => {
  const status = (s: RoomClientState, st: "connecting" | "open" | "reconnecting" | "closed", attempt = 0, reason?: string) =>
    roomReducer(s, { type: "status", status: st, attempt, reason });

  it("tracks the connection state and failed attempts", () => {
    let s = status(initialRoomState, "connecting", 2);
    expect(s).toMatchObject({ connection: "connecting", attempt: 2, everConnected: false });
    s = status(s, "open");
    expect(s).toMatchObject({ connection: "open", attempt: 0, everConnected: true });
    s = status(s, "reconnecting", 1);
    expect(s).toMatchObject({ connection: "reconnecting", attempt: 1, everConnected: true });
  });

  it("keeps the room, view and deadline across a reconnect (the server re-sends them)", () => {
    const room = makeRoom();
    const view = makeView();
    let s = msg(initialRoomState, { t: "room.state", room });
    s = msg(s, { t: "game.view", view, turnDeadline: 5 });
    s = status(s, "reconnecting", 1);
    expect(s).toMatchObject({ room, view, turnDeadline: 5 });
    s = status(s, "open");
    expect(s).toMatchObject({ room, view, turnDeadline: 5 });
  });

  it("records why a connection closed, and clears it when it reopens", () => {
    let s = status(initialRoomState, "closed", 0, "replaced");
    expect(s.closedReason).toBe("replaced");
    s = status(s, "open");
    expect(s.closedReason).toBeNull();
    expect(status(initialRoomState, "closed").closedReason).toBeNull();
  });

  it("reset clears the room state but keeps ids increasing", () => {
    let s = msg(initialRoomState, { t: "game.event", event: { type: "turnChanged", player: "me" } });
    s = msg(s, { t: "room.state", room: makeRoom() });
    s = roomReducer(s, { type: "reset" });
    expect(s).toMatchObject({ room: null, view: null, events: [], lastError: null, connection: "connecting" });
    s = msg(s, { t: "game.event", event: { type: "turnChanged", player: "me" } });
    expect(s.events[0]!.id).toBe(2);
  });
});
