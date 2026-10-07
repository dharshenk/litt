import type { FinishedGameRecord, SqlDb } from "../src/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccounts } from "../src/accounts.js";
import { createBetterSqliteDb, type BetterSqliteDb } from "../src/node.js";

const SECRET = "client-secret-never-log";
const TOKEN = "access-token-never-log";
const PROFILE = { id: "123456789012345678", username: "discord-name", global_name: "Display Name", avatar: "avatar-hash" };
const BASE_URL = "https://litt.example";
const NOW = 1_800_000_000_000;

interface DiscordProfileFixture {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

function oauthCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("litt_oauth="));
  if (!cookie) throw new Error("OAuth cookie missing");
  return cookie.split(";", 1)[0]!;
}

function cookieValue(cookie: string, name: string): string {
  const pair = cookie.split(";", 1)[0]!;
  return pair.slice(name.length + 1);
}

function sessionCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("litt_session="));
  if (!cookie) throw new Error("Session cookie missing");
  return cookie.split(";", 1)[0]!;
}

function makeFetch(profile: DiscordProfileFixture = PROFILE) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://discord.com/api/oauth2/token") {
      return Response.json({ access_token: TOKEN, token_type: "Bearer" });
    }
    if (url === "https://discord.com/api/users/@me") return Response.json(profile);
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
  return { fetcher, calls };
}

async function setup(options: { baseUrl?: string; fetch?: typeof fetch; now?: () => number } = {}) {
  const db = await createBetterSqliteDb(":memory:");
  const accounts = createAccounts({
    db,
    discordClientId: "client-id",
    discordClientSecret: SECRET,
    sessionSecret: "session-secret-for-tests",
    publicBaseUrl: options.baseUrl ?? BASE_URL,
    fetch: options.fetch,
    now: options.now ?? (() => NOW),
  });
  return { db, accounts };
}

async function beginLogin(accounts: Awaited<ReturnType<typeof setup>>["accounts"], next?: string) {
  const response = await accounts.handleLogin(new Request(`https://litt.example/auth/login${next === undefined ? "" : `?next=${encodeURIComponent(next)}`}`));
  const authorization = new URL(response.headers.get("location")!);
  const cookie = oauthCookie(response);
  const encoded = cookieValue(cookie, "litt_oauth").replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(encoded + "=".repeat((4 - encoded.length % 4) % 4));
  const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, (char) => char.charCodeAt(0)))) as { state: string; next: string };
  return { response, authorization, cookie, payload };
}

async function callback(accounts: Awaited<ReturnType<typeof setup>>["accounts"], state: string, cookie: string) {
  return accounts.handleCallback(new Request(`https://litt.example/auth/callback?code=secret-code&state=${encodeURIComponent(state)}`, { headers: { cookie } }));
}

function game(id: string, result: FinishedGameRecord["result"], players: FinishedGameRecord["players"]): FinishedGameRecord {
  return {
    id, startedAt: NOW - 60_000, endedAt: NOW,
    config: { wrongDeclaration: "null", historyLimit: 3 },
    result,
    scores: { A: result === "A" ? 5 : 3, B: result === "B" ? 5 : 3 },
    players,
  };
}

describe("OAuth login", () => {
  let db: BetterSqliteDb | undefined;
  afterEach(() => { db?.close(); db = undefined; });

  it("creates Discord authorization params and a short-lived state cookie", async () => {
    const setupResult = await setup(); db = setupResult.db;
    const { response, authorization, payload } = await beginLogin(setupResult.accounts, "/r/ABCD");
    expect(response.status).toBe(302);
    expect(authorization.origin + authorization.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(authorization.searchParams)).toEqual({
      response_type: "code", client_id: "client-id", scope: "identify", state: payload.state,
      prompt: "none", redirect_uri: "https://litt.example/auth/callback",
    });
    expect(payload.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = response.headers.getSetCookie()[0]!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/auth");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("Secure");
  });

  it.each([
    ["//evil.com", "/"], ["https://evil.com", "/"], ["/r/ABCD", "/r/ABCD"], [undefined, "/"], ["/\\\\evil.com", "/"],
  ])("sanitizes next=%s to %s", async (next, expected) => {
    const setupResult = await setup({ baseUrl: "http://localhost:8787" }); db = setupResult.db;
    const { payload, response } = await beginLogin(setupResult.accounts, next ?? undefined);
    expect(payload.next).toBe(expected);
    expect(response.headers.getSetCookie()[0]).not.toContain("Secure");
  });

  it("uses Secure only when the public callback origin is HTTPS", async () => {
    const setupResult = await setup({ baseUrl: "http://localhost:8787" }); db = setupResult.db;
    const response = await setupResult.accounts.handleLogin(new Request("http://localhost:8787/auth/login"));
    expect(response.headers.getSetCookie()[0]).not.toContain("Secure");
  });
});

describe("OAuth callback and sessions", () => {
  let db: BetterSqliteDb | undefined;
  afterEach(() => { db?.close(); db = undefined; });

  it("exchanges the code, saves Discord profile, signs a session, and redirects to next", async () => {
    const discord = makeFetch();
    const setupResult = await setup({ fetch: discord.fetcher }); db = setupResult.db;
    const login = await beginLogin(setupResult.accounts, "/r/ABCD?from=login");
    const response = await callback(setupResult.accounts, login.payload.state, login.cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/r/ABCD?from=login");
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.getSetCookie()[0]).toContain("litt_session=");
    expect(response.headers.getSetCookie()[0]).toContain("Path=/;");
    expect(response.headers.getSetCookie()[0]).toContain("Max-Age=2592000");
    expect(response.headers.getSetCookie()[0]).toContain("Secure");
    expect(response.headers.getSetCookie()[1]).toContain("litt_oauth=; ");
    expect(response.headers.getSetCookie()[1]).toContain("Path=/auth; Max-Age=0");
    const tokenRequest = discord.calls[0]!;
    expect(tokenRequest.url).toBe("https://discord.com/api/oauth2/token");
    expect(tokenRequest.init?.method).toBe("POST");
    expect(tokenRequest.init?.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    expect(new URLSearchParams(String(tokenRequest.init?.body))).toEqual(new URLSearchParams({
      grant_type: "authorization_code", code: "secret-code", redirect_uri: "https://litt.example/auth/callback",
      client_id: "client-id", client_secret: SECRET,
    }));
    expect(discord.calls[1]!.init?.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
    expect(await setupResult.accounts.getSessionUser(new Request("https://litt.example/api/me", { headers: { cookie: sessionCookie(response) } }))).toEqual({
      id: PROFILE.id, displayName: PROFILE.global_name, avatarUrl: `https://cdn.discordapp.com/avatars/${PROFILE.id}/${PROFILE.avatar}.png?size=128`,
    });
  });

  it.each(["state mismatch", "missing state cookie", "missing state parameter"])("rejects %s with 400", async (scenario) => {
    const setupResult = await setup(); db = setupResult.db;
    const login = await beginLogin(setupResult.accounts);
    const state = scenario === "state mismatch" ? "different" : login.payload.state;
    const cookie = scenario === "missing state cookie" ? "" : login.cookie;
    const url = scenario === "missing state parameter" ? "https://litt.example/auth/callback?code=secret-code" : `https://litt.example/auth/callback?code=secret-code&state=${state}`;
    const response = await setupResult.accounts.handleCallback(new Request(url, { headers: { cookie } }));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

  it("redirects Discord cancellations without contacting Discord", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const setupResult = await setup({ fetch: fetcher }); db = setupResult.db;
    const response = await setupResult.accounts.handleCallback(new Request("https://litt.example/auth/callback?error=access_denied"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/?login=cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns 502 on Discord failures and does not reveal secrets in console output", async () => {
    const fetcher: typeof fetch = async () => new Response("private failure details", { status: 500 });
    const setupResult = await setup({ fetch: fetcher }); db = setupResult.db;
    const login = await beginLogin(setupResult.accounts);
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const outputLog = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const response = await callback(setupResult.accounts, login.payload.state, login.cookie);
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("Discord authentication failed");
      expect(`${output.mock.calls.flat().join(" ")} ${outputLog.mock.calls.flat().join(" ")}`).not.toContain(SECRET);
      expect(`${output.mock.calls.flat().join(" ")} ${outputLog.mock.calls.flat().join(" ")}`).not.toContain(TOKEN);
    } finally {
      output.mockRestore(); outputLog.mockRestore();
    }
  });

  it("returns a generic 502 when Discord profile lookup fails", async () => {
    const fetcher: typeof fetch = async (input) => String(input).endsWith("/token")
      ? Response.json({ access_token: TOKEN })
      : new Response("private profile failure", { status: 503 });
    const setupResult = await setup({ fetch: fetcher }); db = setupResult.db;
    const login = await beginLogin(setupResult.accounts);
    const response = await callback(setupResult.accounts, login.payload.state, login.cookie);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Discord authentication failed");
  });

  it("supports profiles without avatars and refreshes returning users", async () => {
    let profile: DiscordProfileFixture = { id: "returning", username: "first-name", global_name: null, avatar: null };
    const fetcher = makeFetch(profile);
    const setupResult = await setup({ fetch: async (input, init) => {
      fetcher.calls.push({ url: String(input), init });
      if (String(input).endsWith("/token")) return Response.json({ access_token: TOKEN });
      return Response.json(profile);
    } }); db = setupResult.db;
    const login = await beginLogin(setupResult.accounts);
    const first = await callback(setupResult.accounts, login.payload.state, login.cookie);
    expect(first.status).toBe(302);
    expect(await setupResult.accounts.getSessionUser(new Request("https://litt.example", { headers: { cookie: sessionCookie(first) } }))).toEqual({ id: "returning", displayName: "first-name", avatarUrl: null });
    profile = { id: "returning", username: "second-name", global_name: "Updated", avatar: "new-avatar" };
    const secondLogin = await beginLogin(setupResult.accounts);
    const second = await callback(setupResult.accounts, secondLogin.payload.state, secondLogin.cookie);
    expect(await setupResult.accounts.getSessionUser(new Request("https://litt.example", { headers: { cookie: sessionCookie(second) } }))).toEqual({ id: "returning", displayName: "Updated", avatarUrl: "https://cdn.discordapp.com/avatars/returning/new-avatar.png?size=128" });
    expect(await setupResult.db.first("SELECT COUNT(*) AS count FROM users")).toMatchObject({ count: 1 });
  });

  it("rejects tampered payloads, signatures, expired sessions, garbage and deleted users without throwing", async () => {
    let now = NOW;
    const setupResult = await setup({ now: () => now, fetch: makeFetch().fetcher }); db = setupResult.db;
    const login = await beginLogin(setupResult.accounts);
    const response = await callback(setupResult.accounts, login.payload.state, login.cookie);
    const cookie = sessionCookie(response);
    const session = cookieValue(cookie, "litt_session");
    const [payload, signature] = session.split(".");
    const req = (value: string) => new Request("https://litt.example", { headers: { cookie: `litt_session=${value}` } });
    expect(await setupResult.accounts.getSessionUser(req(session))).not.toBeNull();
    expect(await setupResult.accounts.getSessionUser(req(`${payload}x.${signature}`))).toBeNull();
    const alteredSignature = `${signature!.slice(0, -1)}${signature!.endsWith("A") ? "B" : "A"}`;
    expect(await setupResult.accounts.getSessionUser(req(`${payload}.${alteredSignature}`))).toBeNull();
    expect(await setupResult.accounts.getSessionUser(req("garbage"))).toBeNull();
    expect(await setupResult.accounts.getSessionUser(req("%%%..%%%"))).toBeNull();
    now += 30 * 24 * 60 * 60 * 1000;
    expect(await setupResult.accounts.getSessionUser(req(session))).toBeNull();
    await setupResult.db.run("DELETE FROM users WHERE discord_id = ?", [PROFILE.id]);
    now -= 30 * 24 * 60 * 60 * 1000;
    expect(await setupResult.accounts.getSessionUser(req(session))).toBeNull();
  });

  it("clears the session cookie on logout", async () => {
    const setupResult = await setup(); db = setupResult.db;
    const response = await setupResult.accounts.handleLogout(new Request("https://litt.example/auth/logout", { method: "POST" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("litt_session=;");
    expect(response.headers.get("set-cookie")).toContain("Path=/; Max-Age=0; Secure");
    const httpSetup = await setup({ baseUrl: "http://localhost:8787" });
    const insecure = await httpSetup.accounts.handleLogout(new Request("http://localhost/auth/logout", { method: "POST" }));
    expect(insecure.headers.get("set-cookie")).not.toContain("Secure");
    httpSetup.db.close();
  });
});

describe("game persistence and stats", () => {
  let db: BetterSqliteDb | undefined;
  afterEach(() => { db?.close(); db = undefined; });

  it("computes wins, losses, draws and leaderboard ordering from eight players and three games", async () => {
    const setupResult = await setup(); db = setupResult.db;
    for (let index = 0; index < 8; index++) {
      await setupResult.db.run("INSERT INTO users (discord_id, username, display_name, avatar, created_at, last_seen) VALUES (?, ?, ?, NULL, ?, ?)", [`u${index}`, `user${index}`, `Player ${index}`, NOW, NOW]);
    }
    const teams = (ids: number[]) => ids.map((index) => ({ id: `u${index}`, team: index < 4 ? "A" as const : "B" as const }));
    await setupResult.accounts.recordGame(game("g1", "A", teams([0, 1, 2, 3, 4, 5])));
    await setupResult.accounts.recordGame(game("g2", "B", teams([0, 1, 4, 5, 6, 7])));
    await setupResult.accounts.recordGame(game("g3", "draw", teams([0, 2, 4, 6, 1, 5])));
    await setupResult.accounts.recordGame(game("g1", "B", teams([0, 1, 2, 3, 4, 5])));
    expect(await setupResult.accounts.getStats("u0")).toMatchObject({ played: 3, wins: 1, losses: 1, draws: 1 });
    expect(await setupResult.accounts.getStats("u4")).toMatchObject({ played: 3, wins: 1, losses: 1, draws: 1 });
    expect(await setupResult.accounts.getStats("u6")).toMatchObject({ played: 2, wins: 1, losses: 0, draws: 1 });
    expect(await setupResult.accounts.getStats("missing")).toBeNull();
    const leaderboard = await setupResult.accounts.getLeaderboard();
    expect(leaderboard.every((stats) => stats.played > 0)).toBe(true);
    expect(leaderboard.slice(0, 3).map((stats) => stats.id)).toEqual(["u3", "u7", "u2"]);
    expect((await setupResult.db.first<{ count: number }>("SELECT COUNT(*) AS count FROM games"))?.count).toBe(3);
    expect((await setupResult.db.first<{ count: number }>("SELECT COUNT(*) AS count FROM game_players WHERE game_id = 'g1'"))?.count).toBe(6);
  });

  it("migrates idempotently and handles duplicate game/player inserts", async () => {
    const setupResult = await setup(); db = setupResult.db;
    const { migrate } = await import("../src/schema.js");
    await migrate(setupResult.db);
    await setupResult.db.run("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)", ["u", "user", "Name", null, NOW, NOW]);
    const record = game("once", "A", [{ id: "u", team: "A" }, { id: "u", team: "A" }]);
    await setupResult.accounts.recordGame(record);
    await setupResult.accounts.recordGame(record);
    expect(await setupResult.accounts.getStats("u")).toMatchObject({ played: 1, wins: 1, losses: 0, draws: 0 });
  });

  it("contains failures from writes rather than producing partial fake success", async () => {
    const failingDb: SqlDb = {
      async run() { throw new Error("database offline"); },
      async all<T>() { return [] as T[]; },
      async first<T>() { return null as T | null; },
    };
    const accounts = (await import("../src/accounts.js")).createAccounts({
      db: failingDb, discordClientId: "id", discordClientSecret: "secret", sessionSecret: "secret", publicBaseUrl: "https://litt.example",
    });
    await expect(accounts.recordGame(game("fail", "draw", []))).rejects.toThrow("database offline");
  });
});
