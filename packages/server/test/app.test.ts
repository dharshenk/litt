import type { Accounts } from "@litt/accounts";
import type { PlayerStats } from "@litt/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { RoomRegistry } from "../src/registry.js";
import { roomHarness, setTimer, users } from "./helpers.js";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function appHarness(devTools = false) {
  const stats: PlayerStats = { ...users[0]!, played: 3, wins: 2, losses: 1, draws: 0 };
  const accounts = {
    handleLogin: vi.fn<Accounts["handleLogin"]>(async () => new Response(null, { status: 302, headers: { location: "/discord", "set-cookie": "state=value" } })),
    handleCallback: vi.fn<Accounts["handleCallback"]>(async () => new Response(null, { status: 302, headers: { location: "/", "set-cookie": "session=value" } })),
    handleLogout: vi.fn<Accounts["handleLogout"]>(async () => new Response(null, { status: 204, headers: { "set-cookie": "session=; Max-Age=0" } })),
    getSessionUser: vi.fn<Accounts["getSessionUser"]>(async () => null),
    recordGame: vi.fn<Accounts["recordGame"]>(),
    getStats: vi.fn<Accounts["getStats"]>(async (id) => id === "p0" ? stats : null),
    getLeaderboard: vi.fn<Accounts["getLeaderboard"]>(async () => [stats]),
  } satisfies Accounts;
  const harnesses: ReturnType<typeof roomHarness>[] = [];
  const registry = new RoomRegistry({
    factory: () => {
      const harness = roomHarness();
      harnesses.push(harness);
      return harness.room;
    },
    setTimer,
  });
  const app = createApp({ accounts, registry, devTools });
  return { app, accounts, registry, stats, harnesses };
}

describe("createApp", () => {
  it.each([
    ["/auth/login?next=%2Fr%2FABCD", "GET", "handleLogin", 302, "/discord"],
    ["/auth/callback?code=test", "GET", "handleCallback", 302, "/"],
    ["/auth/logout", "POST", "handleLogout", 204, null],
  ] as const)("delegates %s and preserves response headers", async (path, method, handler, status, location) => {
    const { app, accounts } = appHarness();
    const response = await app.request(path, { method, headers: { cookie: "session=test" } });
    expect(response.status).toBe(status);
    expect(response.headers.get("location")).toBe(location);
    expect(response.headers.get("set-cookie")).not.toBeNull();
    const request = accounts[handler].mock.calls[0]![0];
    expect(request).toBeInstanceOf(Request);
    expect(new URL(request.url).pathname).toBe(path.split("?")[0]);
    expect(request.headers.get("cookie")).toBe("session=test");
  });

  it("requires authentication for me and room creation", async () => {
    const { app } = appHarness();
    for (const [path, method] of [["/api/me", "GET"], ["/api/rooms", "POST"]]) {
      const response = await app.request(path!, { method });
      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "Authentication required" });
    }
  });

  it("returns the session profile and creates rooms owned by it", async () => {
    const { app, accounts, registry } = appHarness();
    accounts.getSessionUser.mockResolvedValue(users[0]!);
    expect(await (await app.request("/api/me?devUser=Alice")).json()).toEqual(users[0]);
    const create = vi.spyOn(registry, "create");
    const response = await app.request("/api/rooms", { method: "POST" });
    expect(response.status).toBe(200);
    const result = await response.json() as { code: string };
    expect(registry.get(result.code)).toBeDefined();
    expect(create).toHaveBeenCalledWith("p0");
    expect(accounts.getSessionUser.mock.calls[0]![0].url).toContain("devUser=Alice");
  });

  it("rejects state-changing requests from other origins", async () => {
    const { app, accounts } = appHarness();
    accounts.getSessionUser.mockResolvedValue(users[0]!);
    const post = (path: string, origin: string) => app.request(path, { method: "POST", headers: { origin } });
    for (const path of ["/api/rooms", "/auth/logout"]) {
      const response = await post(path, "https://evil.example");
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Cross-origin request rejected" });
    }
    expect(accounts.handleLogout).not.toHaveBeenCalled();
    expect((await post("/api/rooms", "http://localhost")).status).toBe(200);
    expect((await app.request("/api/me", { headers: { origin: "https://evil.example" } })).status).toBe(200);

    const behindProxy = createApp({ accounts, registry: appHarness().registry, publicOrigin: "https://litt.example" });
    expect((await behindProxy.request("/api/rooms", { method: "POST", headers: { origin: "https://litt.example" } })).status).toBe(200);
  });

  it("rate-limits room creation per user and reports a full server", async () => {
    const { app, accounts } = appHarness();
    accounts.getSessionUser.mockResolvedValue(users[0]!);
    const create = () => app.request("/api/rooms", { method: "POST" });
    for (let index = 0; index < 10; index++) expect((await create()).status).toBe(200);
    const limited = await create();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Too many rooms created; try again later" });
    accounts.getSessionUser.mockResolvedValue(users[1]!);
    expect((await create()).status).toBe(200);
    accounts.getSessionUser.mockResolvedValue(users[0]!);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect((await create()).status).toBe(200);

    const full = new RoomRegistry({ factory: () => roomHarness().room, setTimer, maxRooms: 1 });
    const fullApp = createApp({ accounts, registry: full });
    expect((await fullApp.request("/api/rooms", { method: "POST" })).status).toBe(200);
    const unavailable = await fullApp.request("/api/rooms", { method: "POST" });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "The server has too many open rooms; try again later" });
  });

  it("serves public leaderboard and individual stats with 404 for unknown users", async () => {
    const { app, accounts, stats } = appHarness();
    expect(await (await app.request("/api/stats")).json()).toEqual([stats]);
    expect(await (await app.request("/api/stats/p0")).json()).toEqual(stats);
    expect((await app.request("/api/stats/missing")).status).toBe(404);
    await app.request("/api/stats/dev%3AAlice");
    expect(accounts.getStats).toHaveBeenLastCalledWith("dev:Alice");
    expect(accounts.getSessionUser).not.toHaveBeenCalled();
  });

  it("does not expose adapter-specific WebSocket handling or wrong HTTP methods", async () => {
    const { app } = appHarness();
    expect((await app.request("/ws/rooms/ABCD")).status).toBe(404);
    expect((await app.request("/api/rooms")).status).toBe(404);
    expect((await app.request("/auth/logout")).status).toBe(404);
  });

  it("registers the full-state endpoint only when dev tools are explicitly enabled", async () => {
    const disabled = appHarness();
    expect((await disabled.app.request("/api/dev/rooms/ABCD/state")).status).toBe(404);

    const enabled = appHarness(true);
    const code = enabled.registry.create("p0");
    const harness = enabled.harnesses[0]!;
    harness.start();
    const response = await enabled.app.request(`/api/dev/rooms/${code}/state`);
    expect(response.status).toBe(200);
    const state = await response.json();
    expect(state).toMatchObject({ config: { historyLimit: 3 }, phase: { kind: "turn" } });
    expect(state.players).toHaveLength(6);
    expect(state.players[0]).toEqual({ id: "p0", team: "A" });
    expect((await enabled.app.request("/api/dev/rooms/missing/state")).status).toBe(404);
  });
});
