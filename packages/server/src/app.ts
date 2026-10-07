import type { Accounts } from "@litt/accounts";
import { Hono } from "hono";
import type { RoomRegistry } from "./registry.js";

export interface AppDeps {
  accounts: Accounts;
  registry: RoomRegistry;
  devTools?: boolean;
}

export function createApp({ accounts, registry, devTools = false }: AppDeps): Hono {
  const app = new Hono();
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
    return context.json({ code: registry.create(user.id) });
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