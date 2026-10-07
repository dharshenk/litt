import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDevAccounts } from "../src/dev-accounts.js";
import { createNodeAccounts, startNodeServer } from "../src/node/main.js";

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

  it("requires Discord and session credentials in production even with injected accounts", async () => {
    await expect(startNodeServer({ port: 0, env: { NODE_ENV: "production" }, accounts: createDevAccounts() }))
      .rejects.toThrow("Production requires DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and SESSION_SECRET");
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
        SESSION_SECRET: "session-secret",
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
