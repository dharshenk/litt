import type { Action, GameState } from "@litt/engine";
import type { ClientMessage } from "@litt/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roomHarness, users } from "./helpers.js";

describe("Room", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1000 }));
  afterEach(() => vi.useRealTimers());

  it("joins unassigned, broadcasts membership, and removes lobby departures", () => {
    const { room, sent, connectionsChanged } = roomHarness();
    room.join("p0", users[0]!);
    expect(sent).toEqual([{ connId: "p0", msg: { t: "room.state", room: room.snapshot() } }]);
    room.join("p1", users[1]!);
    expect(room.snapshot().players.map((player) => player.team)).toEqual([null, null]);
    room.leave("p1");
    room.leave("unknown");
    expect(room.snapshot().players.map((player) => player.id)).toEqual(["p0"]);
    expect(room.connectedCount()).toBe(1);
    expect(connectionsChanged).toHaveBeenCalledTimes(3);
  });

  it("rebinds a lobby seat without losing team or join order", () => {
    const { room, message, close } = roomHarness();
    room.join("p0", users[0]!);
    room.join("p1", users[1]!);
    message("p0", { t: "lobby.setTeam", playerId: "p0", team: "A" });
    room.join("new", { ...users[0]!, displayName: "Updated" });
    expect(close).toHaveBeenCalledWith("p0", "replaced");
    room.leave("p0");
    message("p0", { t: "lobby.setTeam", playerId: "p1", team: "B" });
    expect(room.snapshot().players).toMatchObject([
      { id: "p0", displayName: "Updated", team: "A", connected: true },
      { id: "p1", team: null },
    ]);
    expect(room.connectedCount()).toBe(2);
    message("new", { t: "lobby.setTeam", playerId: "p0", team: null });
    expect(room.snapshot().players[0]!.team).toBeNull();
  });

  it("transfers host to the earliest remaining lobby member and fills a vacant host", () => {
    const { room, joinAll } = roomHarness();
    joinAll();
    room.leave("p0");
    expect(room.snapshot().hostId).toBe("p1");
    users.slice(1).forEach((user) => room.leave(user.id));
    room.join("new", users[0]!);
    expect(room.snapshot().hostId).toBe("p0");
  });

  it.each<ClientMessage>([
    { t: "lobby.setTeam", playerId: "p1", team: "A" },
    { t: "lobby.setConfig", config: { wrongDeclaration: "null", historyLimit: 1, turnSeconds: 15 } },
    { t: "lobby.start" }, { t: "room.rematch" },
  ])("requires the host for %j", (msg) => {
    const { joinAll, message, sent } = roomHarness();
    joinAll();
    sent.length = 0;
    message("p1", msg);
    expect(sent).toEqual([{ connId: "p1", msg: { t: "error", code: "NOT_HOST", message: expect.any(String) } }]);
  });

  it("checks every cannot-start reason and forwards engine setup errors", () => {
    const { room, message, joinAll, assignAll, engine, sent } = roomHarness();
    room.join("p0", users[0]!);
    message("p0", { t: "lobby.start" });
    expect(sent.at(-1)!.msg).toMatchObject({ code: "CANNOT_START", message: expect.stringContaining("6") });
    joinAll();
    message("p0", { t: "lobby.start" });
    expect(sent.at(-1)!.msg).toMatchObject({ code: "CANNOT_START", message: expect.stringContaining("assigned") });
    assignAll();
    message("p0", { t: "lobby.setTeam", playerId: "p3", team: "A" });
    message("p0", { t: "lobby.start" });
    expect(sent.at(-1)!.msg).toMatchObject({ code: "CANNOT_START", message: expect.stringContaining("equal") });
    expect(engine.createGame).not.toHaveBeenCalled();
    assignAll();
    engine.createGame.mockReturnValueOnce({ ok: false, error: { code: "INVALID_SETUP", message: "Invalid setup" } });
    message("p0", { t: "lobby.start" });
    expect(sent.at(-1)!.msg).toMatchObject({ code: "INVALID_SETUP" });
    expect(room.snapshot().status).toBe("lobby");
  });

  it("rejects unknown team members and protects snapshot copies", () => {
    const { room, message, sent } = roomHarness();
    room.join("p0", users[0]!);
    message("p0", { t: "lobby.setTeam", playerId: "missing", team: "B" });
    expect(sent.at(-1)!.msg).toMatchObject({ code: "UNKNOWN_PLAYER" });
    const snapshot = room.snapshot();
    snapshot.players[0]!.team = "B";
    snapshot.config.historyLimit = 10;
    expect(room.snapshot().players[0]!.team).toBeNull();
    expect(room.snapshot().config.historyLimit).toBe(3);
  });

  it("starts with alternating teams in team join order and personalized views", () => {
    const { room, start, engine, sent } = roomHarness();
    start();
    expect(engine.createGame.mock.calls[0]![0]).toMatchObject({
      players: [
        { id: "p0", team: "A" }, { id: "p3", team: "B" },
        { id: "p1", team: "A" }, { id: "p4", team: "B" },
        { id: "p2", team: "A" }, { id: "p5", team: "B" },
      ],
      config: { wrongDeclaration: "award", historyLimit: 3 }, rng: expect.any(Function),
    });
    expect(room.snapshot()).toMatchObject({ status: "playing", startedAt: 1000, endedAt: null });
    expect(sent.filter(({ msg }) => msg.t === "game.view")).toHaveLength(6);
    for (const { connId, msg } of sent) {
      if (msg.t === "game.view") expect(msg).toMatchObject({ view: { me: connId }, turnDeadline: null });
    }
  });

  it.each<{ msg: ClientMessage; action: Action }>([
    { msg: { t: "game.ask", target: "p3", card: "3C" }, action: { type: "ask", player: "p0", target: "p3", card: "3C" } },
    { msg: { t: "game.declare", set: "LOW_C", assignment: { "2C": "p0" } }, action: { type: "declare", player: "p0", set: "LOW_C", assignment: { "2C": "p0" } } },
    { msg: { t: "game.choose", player: "p2" }, action: { type: "choose", player: "p0", choice: "p2" } },
  ])("maps $msg.t to an authenticated action and broadcasts results", ({ msg, action }) => {
    const { start, message, engine, sent } = roomHarness();
    start();
    sent.length = 0;
    message("p0", msg);
    expect(engine.apply.mock.calls[0]![1]).toEqual(action);
    expect(sent.filter(({ msg: response }) => response.t === "game.event")).toHaveLength(6);
    expect(sent.filter(({ msg: response }) => response.t === "game.view")).toHaveLength(6);
    expect(sent.slice(0, 6).every(({ msg: response }) => response.t === "game.event")).toBe(true);
  });

  it("forwards rejection only to the sender without rearming the timer", () => {
    const { start, message, engine, sent, timer } = roomHarness();
    start(true);
    sent.length = 0;
    engine.apply.mockReturnValueOnce({ ok: false, error: { code: "NOT_YOUR_TURN", message: "Not your turn" } });
    message("p1", { t: "game.ask", target: "p3", card: "3C" });
    expect(sent).toEqual([{ connId: "p1", msg: { t: "error", code: "NOT_YOUR_TURN", message: "Not your turn" } }]);
    expect(timer).toHaveBeenCalledTimes(1);
  });

  it("rejects game messages in lobby and lobby/rematch messages while playing", () => {
    const { room, message, start, sent } = roomHarness();
    room.join("p0", users[0]!);
    message("p0", { t: "game.choose", player: "p0" });
    expect(sent.at(-1)!.msg).toMatchObject({ code: "WRONG_STATUS" });
    start();
    for (const msg of [
      { t: "lobby.setTeam", playerId: "p1", team: "A" },
      { t: "lobby.setConfig", config: { wrongDeclaration: "award", historyLimit: 3, turnSeconds: null } },
      { t: "lobby.start" }, { t: "room.rematch" },
    ] satisfies ClientMessage[]) {
      message("p0", msg);
      expect(sent.at(-1)!.msg).toMatchObject({ code: "WRONG_STATUS" });
    }
  });

  it("rearms the per-move timer before views and ignores cancelled callbacks", () => {
    const { start, message, engine, sent, timer } = roomHarness();
    start(true);
    expect(sent.at(-1)!.msg).toMatchObject({ turnDeadline: 16000 });
    const stale = timer.mock.calls[0]![1];
    vi.advanceTimersByTime(5000);
    message("p0", { t: "game.choose", player: "p1" });
    expect(sent.at(-1)!.msg).toMatchObject({ turnDeadline: 21000 });
    stale();
    vi.advanceTimersByTime(10000);
    expect(engine.apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(engine.apply.mock.calls[1]![1]).toEqual({ type: "timeout" });
    expect(sent.at(-1)!.msg).toMatchObject({ turnDeadline: 36000 });
    expect(timer).toHaveBeenCalledTimes(3);
  });

  it("keeps disconnected seats, hands off host, and rejoins without replaying events", () => {
    const { room, start, message, sent, engine } = roomHarness();
    start(true);
    message("p0", { t: "game.choose", player: "p1" });
    room.leave("p0");
    expect(room.snapshot().players).toHaveLength(6);
    expect(room.snapshot()).toMatchObject({ hostId: "p1", status: "playing" });
    expect(room.snapshot().players[0]!.connected).toBe(false);
    sent.length = 0;
    room.join("return", users[0]!);
    expect(room.snapshot().hostId).toBe("p1");
    expect(sent.filter(({ connId }) => connId === "return").map(({ msg }) => msg.t)).toEqual(["room.state", "game.view"]);
    expect(sent.at(-1)!.msg).toMatchObject({ view: { me: "p0" }, turnDeadline: 16000 });
    expect(engine.apply).toHaveBeenCalledTimes(1);
  });

  it("rejects non-members mid-game without broadcasting or changing membership", () => {
    const { room, start, sent, close } = roomHarness();
    start();
    sent.length = 0;
    room.join("outsider", { id: "outsider", displayName: "Outsider", avatarUrl: null });
    expect(sent).toEqual([{ connId: "outsider", msg: { t: "error", code: "ROOM_IN_PROGRESS", message: expect.any(String) } }]);
    expect(close).toHaveBeenCalledWith("outsider", "room in progress");
    expect(room.connectedCount()).toBe(6);
  });

  it("records each finished game once, supports final-view reconnects and rematches", () => {
    const { room, start, message, engine, finished, sent } = roomHarness();
    start(true);
    engine.apply.mockImplementation((state) => ({
      ok: true,
      state: { ...state, scores: { A: 5, B: 4 }, phase: { kind: "over", result: "A" } },
      events: [{ type: "gameOver", result: "A", scores: { A: 5, B: 4 } }],
    }));
    vi.advanceTimersByTime(5000);
    message("p0", { t: "game.declare", set: "LOW_C", assignment: {} });
    expect(room.snapshot()).toMatchObject({ status: "finished", startedAt: 1000, endedAt: 6000 });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(finished.mock.calls[0]![0]).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/), startedAt: 1000, endedAt: 6000,
      config: { wrongDeclaration: "null", historyLimit: 5 }, result: "A", scores: { A: 5, B: 4 },
      players: engine.createGame.mock.calls[0]![0].players,
    });
    expect(sent.at(-1)!.msg).toMatchObject({ turnDeadline: null });
    vi.advanceTimersByTime(60000);
    expect(engine.apply).toHaveBeenCalledTimes(1);
    message("p0", { t: "game.choose", player: "p1" });
    expect(sent.at(-1)!.msg).toMatchObject({ code: "WRONG_STATUS" });
    room.leave("p5");
    sent.length = 0;
    room.join("return", users[5]!);
    expect(sent.at(-1)!.msg).toMatchObject({ t: "game.view", view: { me: "p5", phase: { kind: "over", result: "A" } } });
    expect(finished).toHaveBeenCalledTimes(1);
    message("p0", { t: "room.rematch" });
    expect(room.snapshot()).toMatchObject({ status: "lobby", startedAt: null, endedAt: null, config: { turnSeconds: 15 } });
    expect(room.snapshot().players.map((player) => player.team)).toEqual(["A", "A", "A", "B", "B", "B"]);
    room.join("return", users[5]!);
    expect(sent.at(-1)!.msg.t).toBe("room.state");
    message("p0", { t: "lobby.start" });
    message("p0", { t: "game.declare", set: "LOW_C", assignment: {} });
    expect(finished).toHaveBeenCalledTimes(2);
    expect(finished.mock.calls[0]![0].id).not.toBe(finished.mock.calls[1]![0].id);
  });

  it("never sends full hands or another player's private cards after multiple actions", () => {
    const { start, message, sent, engine } = roomHarness();
    start();
    for (let index = 0; index < 4; index++) message("p0", { t: "game.choose", player: "p1" });
    const state = engine.createGame.mock.results[0]!.value;
    if (!state.ok) throw new Error("Fake setup failed");
    const hands: GameState["hands"] = state.state.hands;
    for (const { connId, msg } of sent) {
      const serialized = JSON.stringify(msg);
      expect(serialized).not.toContain('"hands"');
      for (const [playerId, cards] of Object.entries(hands)) {
        if (playerId !== connId) for (const card of cards) expect(serialized).not.toContain(`"${card}"`);
      }
      if (msg.t === "game.view") expect(msg.view.hand).toEqual(state.state.hands[connId]);
    }
  });

  it("handles garbage and pings without throwing, including engine exceptions", () => {
    const { room, start, message, sent, engine } = roomHarness();
    start();
    for (const raw of ["bad", "null", "{}", '{"t":"game.ask"}', "x".repeat(20000)]) {
      expect(() => room.handleMessage("p0", raw)).not.toThrow();
      expect(sent.at(-1)!.msg).toMatchObject({ code: "BAD_MESSAGE" });
    }
    engine.apply.mockImplementation(() => { throw new Error("Engine failure"); });
    expect(() => message("p0", { t: "game.choose", player: "p1" })).not.toThrow();
    expect(sent.at(-1)!.msg).toMatchObject({ code: "BAD_MESSAGE" });
    message("p0", { t: "ping" });
    expect(sent.at(-1)).toEqual({ connId: "p0", msg: { t: "pong" } });
  });

  it("disposes timers and prevents later actions or joins", () => {
    const { room, start, engine, close } = roomHarness();
    start(true);
    room.dispose();
    vi.advanceTimersByTime(30000);
    expect(engine.apply).not.toHaveBeenCalled();
    expect(room.connectedCount()).toBe(0);
    expect(close).toHaveBeenCalledTimes(6);
    room.join("new", users[0]!);
    expect(close).toHaveBeenLastCalledWith("new", "disposed");
  });
});