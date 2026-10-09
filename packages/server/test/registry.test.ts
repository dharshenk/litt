import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Room } from "../src/room.js";
import { RoomRegistry } from "../src/registry.js";
import { fakeEngine, setTimer, users } from "./helpers.js";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function registryHarness() {
  const engine = fakeEngine();
  const close = vi.fn();
  const timers = vi.fn(setTimer);
  const factory = vi.fn((code: string, hostId: string, onConnectionsChanged: () => void) => new Room({
    code, hostId, onConnectionsChanged, engine, rng: () => 0,
    now: Date.now, setTimer: timers, send: () => {}, closeConnection: close, onGameFinished: () => {},
  }));
  const registry = new RoomRegistry({ factory, setTimer: timers, rng: () => 0 });
  return { registry, factory, engine, close, timers };
}

describe("RoomRegistry", () => {
  it("creates unique valid codes even when RNG values collide", () => {
    const { registry, factory } = registryHarness();
    const codes = Array.from({ length: 50 }, () => registry.create("p0"));
    expect(new Set(codes).size).toBe(50);
    expect(codes.every((code) => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(code))).toBe(true);
    expect(factory).toHaveBeenCalledWith(codes[0], "p0", expect.any(Function));
    expect(registry.get("NOPE")).toBeUndefined();
  });

  it("refuses new rooms once the open-room limit is reached", () => {
    const engine = fakeEngine();
    const registry = new RoomRegistry({
      setTimer, maxRooms: 2,
      factory: (code, hostId, onConnectionsChanged) => new Room({
        code, hostId, onConnectionsChanged, engine, rng: () => 0,
        now: Date.now, setTimer, send: () => {}, closeConnection: () => {}, onGameFinished: () => {},
      }),
    });
    registry.create("p0");
    registry.create("p1");
    expect(() => registry.create("p2")).toThrow("No room codes available");
  });

  it("disposes never-joined rooms after exactly 30 minutes and frees the code", () => {
    const { registry } = registryHarness();
    const code = registry.create("p0");
    const room = registry.get(code)!;
    const dispose = vi.spyOn(room, "dispose");
    vi.advanceTimersByTime(30 * 60 * 1000 - 1);
    expect(registry.get(code)).toBe(room);
    vi.advanceTimersByTime(1);
    expect(registry.get(code)).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
    expect(registry.create("p0")).toBe(code);
  });

  it("cancels cleanup on join and restarts a full interval after the last leave", () => {
    const { registry } = registryHarness();
    const code = registry.create("p0");
    const room = registry.get(code)!;
    vi.advanceTimersByTime(29 * 60 * 1000);
    room.join("c0", users[0]!);
    room.join("c1", users[1]!);
    vi.advanceTimersByTime(60 * 60 * 1000);
    room.leave("c0");
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(registry.get(code)).toBe(room);
    room.leave("c1");
    vi.advanceTimersByTime(29 * 60 * 1000);
    room.join("new", users[0]!);
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(registry.get(code)).toBe(room);
    room.leave("new");
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(registry.get(code)).toBeUndefined();
  });

  it("ignores cancelled idle callbacks from a previous empty period", () => {
    const { registry, timers } = registryHarness();
    const code = registry.create("p0");
    const room = registry.get(code)!;
    const stale = timers.mock.calls[0]![1];
    room.join("c0", users[0]!);
    room.leave("c0");
    stale();
    expect(registry.get(code)).toBe(room);
  });

  it("disposes all rooms and their idle timers on adapter shutdown", () => {
    const { registry } = registryHarness();
    const codes = [registry.create("p0"), registry.create("p1")];
    const disposals = codes.map((code) => vi.spyOn(registry.get(code)!, "dispose"));
    registry.dispose();
    expect(codes.every((code) => registry.get(code) === undefined)).toBe(true);
    expect(disposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disposes game timers and blocks stale room references after expiry", () => {
    const { registry, engine, close } = registryHarness();
    const code = registry.create("p0");
    const room = registry.get(code)!;
    for (const [index, user] of users.entries()) {
      room.join(user.id, user);
      room.handleMessage("p0", JSON.stringify({ t: "lobby.setTeam", playerId: user.id, team: index < 3 ? "A" : "B" }));
    }
    room.handleMessage("p0", JSON.stringify({ t: "lobby.setConfig", config: { wrongDeclaration: "award", historyLimit: 3, turnSeconds: 15 } }));
    room.handleMessage("p0", '{"t":"lobby.start"}');
    for (const user of users) room.leave(user.id);
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(registry.get(code)).toBeUndefined();
    const calls = engine.apply.mock.calls.length;
    vi.advanceTimersByTime(60000);
    expect(engine.apply).toHaveBeenCalledTimes(calls);
    room.join("late", users[0]!);
    expect(close).toHaveBeenCalledWith("late", "disposed");
  });
});
