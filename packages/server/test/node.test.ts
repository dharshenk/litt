import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDevAccounts } from "../src/dev-accounts.js";
import { WebSocket } from "ws";
import { createNodeAccounts, startNodeServer } from "../src/node/main.js";

const SESSION_SECRET = "0123456789abcdef0123456789abcdef";

const servers: Awaited<ReturnType<typeof startNodeServer>>[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("Node adapter production integration", () => {
  it("accepts per-tab dev logins in explicit development mode even with Discord credentials", async () => {
    const accounts = await createNodeAccounts({
      NODE_ENV: "development",
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_CLIENT_SECRET: "client-secret",
      SESSION_SECRET: "session-secret",
    });
    const server = await startNodeServer({
      port: 0,
      hostname: "127.0.0.1",
      accounts,
      env: { NODE_ENV: "development" },
      staticDirectory: null,
    });
    servers.push(server);
    const response = await fetch(`${server.url}/api/me?devUser=alice`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "dev:alice", displayName: "alice", avatarUrl: null });
    expect((await fetch(`${server.url}/api/me`)).status).toBe(401);
  });

  it("rejects per-tab dev identities in production with Discord credentials configured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "litt-accounts-"));
    directories.push(directory);
    const accounts = await createNodeAccounts({
      NODE_ENV: "production",
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_CLIENT_SECRET: "client-secret",
      SESSION_SECRET: "session-secret",
      DATABASE_PATH: join(directory, "accounts.db"),
    });
    expect(await accounts.getSessionUser(new Request("http://localhost/api/me?devUser=alice"))).toBeNull();
  });

  it("requires OAuth and session credentials in production even with injected accounts", async () => {
    await expect(startNodeServer({ port: 0, env: { NODE_ENV: "production" }, accounts: createDevAccounts() }))
      .rejects.toThrow("Production requires SESSION_SECRET and a complete Discord or Google client id/secret pair");
  });

  it("serves static assets and SPA routes but never registers dev state in production", async () => {
    const staticDirectory = await mkdtemp(join(tmpdir(), "litt-web-"));
    directories.push(staticDirectory);
    await mkdir(join(staticDirectory, "assets"));
    await writeFile(join(staticDirectory, "index.html"), "<!doctype html><title>Litt test build</title>");
    await writeFile(join(staticDirectory, "assets", "app.js"), "window.litt = true;");
    const server = await startNodeServer({
      port: 0,
      hostname: "127.0.0.1",
      accounts: createDevAccounts(),
      env: {
        NODE_ENV: "production",
        LITT_DEV_TOOLS: "1",
        DISCORD_CLIENT_ID: "client-id",
        DISCORD_CLIENT_SECRET: "client-secret",
        SESSION_SECRET,
        PUBLIC_BASE_URL: "https://litt.example",
      },
      staticDirectory: `${staticDirectory}${sep}`,
    });
    servers.push(server);

    const home = await fetch(`${server.url}/`);
    const room = await fetch(`${server.url}/r/ABCD`);
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toContain("Litt test build");
    expect(await room.text()).toContain("Litt test build");
    const asset = await fetch(`${server.url}/assets/app.js`);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(await asset.text()).toBe("window.litt = true;");

    const api = await fetch(`${server.url}/api/dev/rooms/ABCD/state`);
    expect(api.status).toBe(404);
    expect(await api.text()).toBe("404 Not Found");
    expect((await fetch(`${server.url}/not-a-spa-route`)).status).toBe(404);

    const csp = home.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self' wss://litt.example");
    for (const response of [home, asset, api]) {
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe("same-origin");
      expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    }
    expect(api.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects weak session secrets in production", async () => {
    await expect(startNodeServer({
      port: 0,
      accounts: createDevAccounts(),
      env: { NODE_ENV: "production", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", SESSION_SECRET: "short" },
    })).rejects.toThrow("SESSION_SECRET must be at least 32 characters");
  });

  it("uses dev accounts only in explicit development mode", async () => {
    for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "test" }]) {
      await expect(createNodeAccounts(env)).rejects.toThrow("Configure Discord or Google OAuth, or set NODE_ENV=development");
    }
  });

  it("does not mount the dev-state route outside explicit development mode", async () => {
    const server = await startNodeServer({
      port: 0,
      hostname: "127.0.0.1",
      accounts: createDevAccounts(),
      env: { LITT_DEV_TOOLS: "1" },
      staticDirectory: null,
    });
    servers.push(server);
    const response = await fetch(`${server.url}/api/dev/rooms/ABCD/state`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("404 Not Found");
  });

  it("does not mount the dev-state route unless the explicit non-production flag is set", async () => {
    const server = await startNodeServer({
      port: 0,
      hostname: "127.0.0.1",
      accounts: createDevAccounts(),
      env: { NODE_ENV: "development", LITT_DEV_TOOLS: "1" },
      staticDirectory: null,
    });
    servers.push(server);
    const enabled = await fetch(`${server.url}/api/dev/rooms/ABCD/state`);
    expect(enabled.status).toBe(404);
    expect(await enabled.json()).toEqual({ error: "Game state not found" });
  });
});

describe("Node adapter WebSockets", () => {
  async function devServer() {
    const server = await startNodeServer({
      port: 0,
      hostname: "127.0.0.1",
      accounts: createDevAccounts(),
      env: { NODE_ENV: "development", PUBLIC_BASE_URL: "https://litt.example" },
      staticDirectory: null,
    });
    servers.push(server);
    const { code } = await (await fetch(`${server.url}/api/rooms?devUser=alice`, { method: "POST" })).json() as { code: string };
    const address = `${server.url.replace("http:", "ws:")}/ws/rooms/${code}?devUser=alice`;
    return { server, address };
  }

  function handshakeStatus(address: string, origin?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(address, origin ? { origin } : {});
      socket.once("open", () => { socket.close(); resolve(101); });
      socket.once("unexpected-response", (_request, response) => { socket.terminate(); resolve(response.statusCode ?? 0); });
      socket.once("error", reject);
    });
  }

  it("rejects handshakes from other origins", async () => {
    const { server, address } = await devServer();
    expect(await handshakeStatus(address, "https://evil.example")).toBe(403);
    expect(await handshakeStatus(address, "null")).toBe(403);
    expect(await handshakeStatus(address, "https://litt.example")).toBe(101);
    expect(await handshakeStatus(address, server.url.replace("localhost", "127.0.0.1"))).toBe(403);
    expect(await handshakeStatus(address, server.url)).toBe(101);
    expect(await handshakeStatus(address)).toBe(101);
  });

  it("closes connections that flood messages", async () => {
    const { address } = await devServer();
    const socket = new WebSocket(address);
    await new Promise((resolve) => socket.once("open", resolve));
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    for (let index = 0; index < 100; index++) socket.send(JSON.stringify({ t: "ping" }));
    expect(await closed).toBe(1008);
  });
});
