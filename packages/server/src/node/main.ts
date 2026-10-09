import { serve } from "@hono/node-server";
import type { Accounts } from "@litt/accounts";
import { createGame, apply, playerView, type Engine } from "@litt/engine";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { createApp } from "../app.js";
import { createDevAccounts } from "../dev-accounts.js";
import { RoomRegistry } from "../registry.js";
import { Room } from "../room.js";
import { RateLimiter, TokenBucket, isAllowedOrigin, secureRandom } from "../security.js";

const MIN_SESSION_SECRET_LENGTH = 32;
const SOCKETS_PER_USER = 8;
const UPGRADES_PER_USER_PER_MINUTE = 30;
const MESSAGE_BURST = 40;
const MESSAGES_PER_SECOND = 10;
const HEARTBEAT_MS = 30_000;

export async function createNodeAccounts(env: NodeJS.ProcessEnv = process.env, port = 8787): Promise<Accounts> {
  // Dev accounts let anyone sign in as any name, so they need an explicit opt-in rather than being the fallback.
  if (env.NODE_ENV === "development") return createDevAccounts();
  if (!(env.DISCORD_CLIENT_ID || env.GOOGLE_CLIENT_ID)) {
    throw new Error("Configure Discord or Google OAuth, or set NODE_ENV=development to use local dev accounts");
  }
  if (env.DISCORD_CLIENT_ID && !env.DISCORD_CLIENT_SECRET) throw new Error("DISCORD_CLIENT_SECRET is required with DISCORD_CLIENT_ID");
  if (env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET is required with GOOGLE_CLIENT_ID");
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is required when OAuth login is configured");
  const { createAccounts } = await import("@litt/accounts");
  const { createBetterSqliteDb } = await import("@litt/accounts/node");
  return createAccounts({
    db: await createBetterSqliteDb(env.DATABASE_PATH ?? "./litt.db"),
    discordClientId: env.DISCORD_CLIENT_ID,
    discordClientSecret: env.DISCORD_CLIENT_SECRET,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    sessionSecret: env.SESSION_SECRET,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
  });
}

export interface NodeServerOptions {
  port?: number;
  hostname?: string;
  accounts?: Accounts;
  env?: NodeJS.ProcessEnv;
  staticDirectory?: string | null;
}

export async function startNodeServer(options: NodeServerOptions = {}) {
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer between 0 and 65535");
  let publicUrl: URL;
  try {
    publicUrl = new URL(env.PUBLIC_BASE_URL ?? `http://localhost:${port}`);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be an absolute URL such as https://litt.example.com");
  }
  if (env.NODE_ENV === "production") {
    if (!env.SESSION_SECRET || !((env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) || (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET))) {
      throw new Error("Production requires SESSION_SECRET and a complete Discord or Google client id/secret pair");
    }
    if (env.SESSION_SECRET.length < MIN_SESSION_SECRET_LENGTH) {
      throw new Error(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters (e.g. openssl rand -hex 32)`);
    }
    if (publicUrl.protocol !== "https:") {
      console.warn("PUBLIC_BASE_URL is not https: session cookies and OAuth codes are sent unencrypted. Serve Litt behind a TLS proxy and set PUBLIC_BASE_URL to its https:// origin.");
    }
  }
  const accounts = options.accounts ?? await createNodeAccounts(env, port);
  const engine: Engine = { createGame, apply, playerView };
  const sockets = new Map<string, WebSocket>();
  const socketsPerUser = new Map<string, number>();
  /** Sockets that answered the last heartbeat ping. */
  const alive = new WeakSet<WebSocket>();
  const upgradeLimiter = new RateLimiter(UPGRADES_PER_USER_PER_MINUTE, 60_000);
  const setTimer = (ms: number, callback: () => void): (() => void) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  };
  const registry = new RoomRegistry({
    setTimer,
    factory: (code, hostId, onConnectionsChanged) => new Room({
      code, hostId, onConnectionsChanged, engine, rng: secureRandom, now: Date.now, setTimer,
      send: (connId, msg) => {
        const socket = sockets.get(connId);
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
      },
      closeConnection: (connId, reason) => { sockets.get(connId)?.close(4000, reason); },
      onGameFinished: (record) => {
        void accounts.recordGame(record).catch((error: unknown) => { console.error("Failed to record finished game", error); });
      },
    }),
  });
  const app = createApp({
    accounts, registry, publicOrigin: publicUrl.origin,
    devTools: env.LITT_DEV_TOOLS === "1" && env.NODE_ENV === "development",
  });
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const staticDirectory = options.staticDirectory !== undefined
    ? options.staticDirectory
    : env.NODE_ENV === "production"
      ? fileURLToPath(new URL("../../../../packages/web/dist/", import.meta.url))
      : null;
  const staticRoot = staticDirectory ? resolve(staticDirectory) : null;
  const mimeTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  };
  const baseHeaders: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    // Room links carry the join code; keep it from leaking to other sites in Referer.
    "referrer-policy": "same-origin",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
  if (publicUrl.protocol === "https:") baseHeaders["strict-transport-security"] = "max-age=31536000";
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://cdn.discordapp.com https://*.googleusercontent.com",
    `connect-src 'self' ${publicUrl.protocol === "https:" ? "wss:" : "ws:"}//${publicUrl.host}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const fetchRequest: typeof app.fetch = async (request, envArg, executionCtx) => {
    const url = new URL(request.url);
    const isApi = ["/api", "/auth", "/ws"].some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
    const served = await route(url, isApi, request, envArg, executionCtx);
    // Copied so the headers are mutable whichever handler built the response.
    const response = new Response(served.body, served);
    for (const [name, value] of Object.entries(baseHeaders)) response.headers.set(name, value);
    // The dev login page has inline styles and is never served alongside the built SPA.
    if (staticRoot) response.headers.set("content-security-policy", contentSecurityPolicy);
    if (isApi && !response.headers.has("cache-control")) response.headers.set("cache-control", "no-store");
    return response;
  };
  const route = async (url: URL, isApi: boolean, ...args: Parameters<typeof app.fetch>): Promise<Response> => {
    const [request] = args;
    if (!staticRoot || request.method !== "GET" || isApi) return app.fetch(...args);
    const spaRoute = url.pathname === "/" || /^\/r\/[^/]+\/?$/.test(url.pathname);
    let pathname = spaRoute ? "/index.html" : url.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const filePath = resolve(staticRoot, `.${pathname}`);
    if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${sep}`)) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const body = await readFile(filePath);
      return new Response(body, { headers: { "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream" } });
    } catch {
      return spaRoute ? app.fetch(new Request(new URL("/index.html", request.url), request)) : app.fetch(...args);
    }
  };
  const server = serve({ fetch: fetchRequest, port, hostname: options.hostname });

  const rejectUpgrade = (socket: Duplex, status: number, message: string) => {
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  const upgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${port}`}`);
      const match = /^\/ws\/rooms\/([^/]+)$/.exec(url.pathname);
      if (!match) {
        rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      // SameSite=Lax is the only other defence against another site opening a socket with the player's cookie.
      if (!isAllowedOrigin(req.headers.origin, req.headers.host, publicUrl.origin)) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      const request = new Request(url, { headers: req.headers.cookie ? { cookie: req.headers.cookie } : {} });
      const user = await accounts.getSessionUser(request);
      if (!user) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      // Limits guessing room codes and holding open sockets in many rooms.
      if (!upgradeLimiter.take(user.id) || (socketsPerUser.get(user.id) ?? 0) >= SOCKETS_PER_USER) {
        rejectUpgrade(socket, 429, "Too Many Requests");
        return;
      }
      const room = registry.get(match[1]!);
      if (!room) {
        rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      if (socket.destroyed) return;
      wsServer.handleUpgrade(req, socket, head, (connection) => {
        const connId = randomUUID();
        const messages = new TokenBucket(MESSAGE_BURST, MESSAGES_PER_SECOND);
        sockets.set(connId, connection);
        socketsPerUser.set(user.id, (socketsPerUser.get(user.id) ?? 0) + 1);
        alive.add(connection);
        connection.on("pong", () => { alive.add(connection); });
        connection.on("message", (data, isBinary) => {
          if (!messages.take()) {
            connection.close(1008, "rate limited");
            return;
          }
          room.handleMessage(connId, isBinary ? "" : data.toString());
        });
        connection.on("close", () => {
          sockets.delete(connId);
          const remaining = (socketsPerUser.get(user.id) ?? 1) - 1;
          if (remaining > 0) socketsPerUser.set(user.id, remaining);
          else socketsPerUser.delete(user.id);
          room.leave(connId);
        });
        connection.on("error", () => { connection.terminate(); });
        room.join(connId, user);
      });
    } catch (error) {
      console.error("WebSocket upgrade failed", error);
      if (!socket.destroyed) rejectUpgrade(socket, 500, "Internal Server Error");
    }
  };
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => { socket.destroy(); });
    void upgrade(req, socket, head);
  });

  // Protocol-level pings are answered by the browser even in throttled background tabs, so a missing pong
  // means the peer is gone; without this, half-open sockets would hold seats and memory indefinitely.
  const heartbeat = setInterval(() => {
    for (const connection of sockets.values()) {
      if (!alive.has(connection)) {
        connection.terminate();
        continue;
      }
      alive.delete(connection);
      connection.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server has no TCP address");
  const url = `http://localhost:${address.port}`;

  const stop = async (): Promise<void> => {
    clearInterval(heartbeat);
    registry.dispose();
    for (const connection of sockets.values()) connection.terminate();
    await new Promise<void>((resolve) => { wsServer.close(() => { resolve(); }); });
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); });
  };
  return { server, wsServer, registry, accounts, url, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startNodeServer().then((running) => {
    console.info(`Litt server listening at ${running.url}`);
    const shutdown = () => {
      void running.stop().then(() => { process.exit(0); }).catch((error: unknown) => {
        console.error(error);
        process.exit(1);
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
