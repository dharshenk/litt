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

export async function createNodeAccounts(env: NodeJS.ProcessEnv = process.env, port = 8787): Promise<Accounts> {
  if (env.NODE_ENV === "development" || !(env.DISCORD_CLIENT_ID || env.GOOGLE_CLIENT_ID)) {
    if (env.NODE_ENV === "production") throw new Error("Production requires Discord or Google authentication; dev accounts are disabled");
    return createDevAccounts();
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
  if (env.NODE_ENV === "production" && (!env.SESSION_SECRET || !((env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) || (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)))) {
    throw new Error("Production requires SESSION_SECRET and a complete Discord or Google client id/secret pair");
  }
  const accounts = options.accounts ?? await createNodeAccounts(env, port);
  const engine: Engine = { createGame, apply, playerView };
  const sockets = new Map<string, WebSocket>();
  const setTimer = (ms: number, callback: () => void): (() => void) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  };
  const registry = new RoomRegistry({
    setTimer,
    factory: (code, hostId, onConnectionsChanged) => new Room({
      code, hostId, onConnectionsChanged, engine, rng: Math.random, now: Date.now, setTimer,
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
  const app = createApp({ accounts, registry, devTools: env.LITT_DEV_TOOLS === "1" && env.NODE_ENV !== "production" });
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
  const fetchRequest: typeof app.fetch = async (request, envArg, executionCtx) => {
    const url = new URL(request.url);
    const isApi = ["/api", "/auth", "/ws"].some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
    if (!staticRoot || request.method !== "GET" || isApi) return app.fetch(request, envArg, executionCtx);
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
      return spaRoute ? app.fetch(new Request(new URL("/index.html", request.url), request)) : app.fetch(request, envArg, executionCtx);
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
      const request = new Request(url, { headers: req.headers.cookie ? { cookie: req.headers.cookie } : {} });
      const user = await accounts.getSessionUser(request);
      if (!user) {
        rejectUpgrade(socket, 401, "Unauthorized");
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
        sockets.set(connId, connection);
        connection.on("message", (data, isBinary) => { room.handleMessage(connId, isBinary ? "" : data.toString()); });
        connection.on("close", () => { sockets.delete(connId); room.leave(connId); });
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

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server has no TCP address");
  const url = `http://localhost:${address.port}`;

  const stop = async (): Promise<void> => {
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
