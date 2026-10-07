import type { FinishedGameRecord } from "@litt/accounts";
import { describe, expect, it } from "vitest";
import { createDevAccounts } from "../src/dev-accounts.js";

function request(path = "/", cookie?: string): Request {
  return new Request(`http://localhost:8787${path}`, { headers: cookie ? { cookie } : {} });
}

function record(id: string, result: FinishedGameRecord["result"]): FinishedGameRecord {
  return {
    id, startedAt: 100, endedAt: 200, config: { wrongDeclaration: "null", historyLimit: 3 },
    scores: { A: 4, B: 4 }, result,
    players: [{ id: "dev:Alice", team: "A" }, { id: "dev:Bob", team: "B" }],
  };
}

describe("dev accounts", () => {
  it("reads cookie identity and lets the devUser query override it", async () => {
    const accounts = createDevAccounts();
    expect(await accounts.getSessionUser(request("/api/me", "other=x; litt_dev_user=Alice"))).toEqual({ id: "dev:Alice", displayName: "Alice", avatarUrl: null });
    expect(await accounts.getSessionUser(request("/ws/rooms/ABCD?devUser=Bob", "litt_dev_user=Alice"))).toEqual({ id: "dev:Bob", displayName: "Bob", avatarUrl: null });
    expect(await accounts.getSessionUser(request())).toBeNull();
  });

  it.each(["", "has space", "<script>", "abcdefghijklmnopqrstu", "name.dot", "name/slash", "\u00e9", "Alice\n", "Alice\r", "Alice\r\n"])("rejects invalid name %j without falling back to cookie", async (name) => {
    const accounts = createDevAccounts();
    expect(await accounts.getSessionUser(request(`/?devUser=${encodeURIComponent(name)}`, "litt_dev_user=Alice"))).toBeNull();
    expect(await accounts.getSessionUser(request("/", `litt_dev_user=${encodeURIComponent(name)}`))).toBeNull();
    expect((await accounts.handleLogin(request(`/auth/login?name=${encodeURIComponent(name)}`))).status).toBe(400);
  });

  it("rejects malformed cookie escapes and accepts boundary-length and safe punctuation", async () => {
    const accounts = createDevAccounts();
    expect(await accounts.getSessionUser(request("/", "litt_dev_user=%E0%A4%A"))).toBeNull();
    expect(await accounts.getSessionUser(request("/?devUser=A_-123"))).toMatchObject({ id: "dev:A_-123" });
    expect(await accounts.getSessionUser(request(`/?devUser=${"A".repeat(20)}`))).not.toBeNull();
  });

  it("serves a name form and signs in with a cookie and local redirect", async () => {
    const accounts = createDevAccounts();
    const form = await accounts.handleLogin(request("/auth/login?next=%2Fr%2FABCD"));
    expect(form.headers.get("content-type")).toContain("text/html");
    expect(await form.text()).toContain('name="name"');
    const response = await accounts.handleLogin(request("/auth/login?name=Alice&next=%2Fr%2FABCD"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/r/ABCD");
    expect(response.headers.get("set-cookie")).toBe("litt_dev_user=Alice; Path=/; HttpOnly; SameSite=Lax");
    expect((await accounts.handleCallback(request("/auth/callback?name=Bob"))).headers.get("location")).toBe("/");
    const secure = await accounts.handleLogin(new Request("https://litt.test/auth/login?name=Alice"));
    expect(secure.headers.get("set-cookie")).toContain("; Secure");
    const logout = await accounts.handleLogout(request("/auth/logout"));
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each(["https://other.test/", "//other.test/", "/\\other.test/", "javascript:alert(1)"])("rejects external next redirect %s", async (next) => {
    const accounts = createDevAccounts();
    const response = await accounts.handleLogin(request(`/auth/login?name=Alice&next=${encodeURIComponent(next)}`));
    expect(response.headers.get("location")).toBe("/");
  });

  it("escapes next in the login form", async () => {
    const form = await createDevAccounts().handleLogin(request(`/auth/login?next=${encodeURIComponent('/?q=" onfocus="alert(1)&x=<script>')}`));
    const html = await form.text();
    expect(html).not.toContain(' onfocus="');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp;");
  });

  it("computes played, wins, losses and draws, deduplicates records, and sorts by wins", async () => {
    const accounts = createDevAccounts();
    await accounts.getSessionUser(request("/?devUser=Idle"));
    await accounts.recordGame(record("first", "A"));
    await accounts.recordGame(record("first", "A"));
    await accounts.recordGame(record("second", "B"));
    await accounts.recordGame(record("third", "draw"));
    await accounts.recordGame(record("fourth", "B"));
    expect(await accounts.getStats("dev:Alice")).toMatchObject({ played: 4, wins: 1, losses: 2, draws: 1 });
    expect(await accounts.getStats("dev:Bob")).toMatchObject({ played: 4, wins: 2, losses: 1, draws: 1 });
    expect(await accounts.getStats("dev:Idle")).toMatchObject({ played: 0, wins: 0, losses: 0, draws: 0 });
    expect(await accounts.getStats("missing")).toBeNull();
    expect((await accounts.getLeaderboard()).map((stats) => stats.id)).toEqual(["dev:Bob", "dev:Alice", "dev:Idle"]);
    const stats = (await accounts.getStats("dev:Bob"))!;
    stats.wins = 100;
    expect((await accounts.getStats("dev:Bob"))!.wins).toBe(2);
  });
});