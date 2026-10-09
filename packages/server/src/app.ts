import type { Accounts } from "@litt/accounts";
import { Hono } from "hono";
import type { RoomRegistry } from "./registry.js";
import { RateLimiter, isAllowedOrigin } from "./security.js";

const ROOMS_PER_USER = 10;
const ROOM_WINDOW_MS = 10 * 60 * 1000;

export interface AppDeps {
  accounts: Accounts;
  registry: RoomRegistry;
  devTools?: boolean;
  /** Origin of PUBLIC_BASE_URL. Browser requests that change state must come from it or from the requested host. */
  publicOrigin?: string;
}

export function createApp({ accounts, registry, devTools = false, publicOrigin }: AppDeps): Hono {
  const app = new Hono();
  const roomCreation = new RateLimiter(ROOMS_PER_USER, ROOM_WINDOW_MS);

  app.use(async (context, next) => {
    const safe = context.req.method === "GET" || context.req.method === "HEAD" || context.req.method === "OPTIONS";
    if (!safe && !isAllowedOrigin(context.req.header("origin"), new URL(context.req.url).host, publicOrigin)) {
      return context.json({ error: "Cross-origin request rejected" }, 403);
    }
    await next();
  });

  app.get("/auth/login", (context) => accounts.handleLogin(context.req.raw));
  app.get("/auth/callback", (context) => accounts.handleCallback(context.req.raw));
  app.post("/auth/logout", (context) => accounts.handleLogout(context.req.raw));

  app.get("/api/me", async (context) => {
    const user = await accounts.getSessionUser(context.req.raw);
    return user ? context.json(user) : context.json({ error: "Authentication required" }, 401);
  });

  app.post("/api/rooms", async (context) => {
    const user = await accounts.getSessionUser(context.req.raw);
    if (!user) return context.json({ error: "Authentication required" }, 401);
    if (!roomCreation.take(user.id)) return context.json({ error: "Too many rooms created; try again later" }, 429);
    let code: string;
    try {
      code = registry.create(user.id);
    } catch {
      return context.json({ error: "The server has too many open rooms; try again later" }, 503);
    }
    return context.json({ code });
  });

  app.get("/api/stats", async (context) => context.json(await accounts.getLeaderboard()));
  app.get("/api/stats/:userId", async (context) => {
    const stats = await accounts.getStats(context.req.param("userId"));
    return stats ? context.json(stats) : context.json({ error: "User not found" }, 404);
  });

  if (devTools) {
    app.get("/api/dev/rooms/:code/state", (context) => {
      const state = registry.get(context.req.param("code"))?.devState();
      return state ? context.json(state) : context.json({ error: "Game state not found" }, 404);
    });
  }

  return app;
}
