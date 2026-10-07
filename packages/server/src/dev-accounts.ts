import type { Accounts, FinishedGameRecord } from "@litt/accounts";
import type { PlayerStats, UserProfile } from "@litt/protocol";

const INVALID_NAME_CHARACTER = /[^A-Za-z0-9_-]/;
const COOKIE = "litt_dev_user";

function isValidName(name: string): boolean {
  return name.length >= 1 && name.length <= 20 && !INVALID_NAME_CHARACTER.test(name);
}

function escapeHtml(value: string): string {
  const replacements: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => replacements[character]!);
}

function redirectPath(url: URL): string {
  const next = url.searchParams.get("next");
  if (!next?.startsWith("/")) return "/";
  const destination = new URL(next, url);
  return destination.origin === url.origin ? destination.pathname + destination.search + destination.hash : "/";
}

function cookieName(req: Request): string | null {
  const cookie = req.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(COOKIE.length + 1));
  } catch {
    return null;
  }
}

export function createDevAccounts(): Accounts {
  const users = new Map<string, UserProfile>();
  const games = new Map<string, FinishedGameRecord>();

  function remember(name: string): UserProfile {
    const user = { id: `dev:${name}`, displayName: name, avatarUrl: null };
    users.set(user.id, user);
    return { ...user };
  }

  async function handleLogin(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const next = redirectPath(url);
    const name = url.searchParams.get("name");
    if (name !== null) {
      if (!isValidName(name)) return new Response("Invalid name", { status: 400 });
      remember(name);
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return new Response(null, {
        status: 302,
        headers: { location: next, "set-cookie": `${COOKIE}=${name}; Path=/; HttpOnly; SameSite=Lax${secure}` },
      });
    }
    return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Litt | Local sign-in</title><style>
body { margin: 0; background: #f2efe7; color: #18201b; font-family: sans-serif; }
main { max-width: 320px; margin: 12vh auto; padding: 24px; }
h1 { font: 38px Georgia, serif; } label { display: block; margin-bottom: 8px; }
input, button { box-sizing: border-box; width: 100%; padding: 12px; border: 1px solid #98a29b; border-radius: 8px; font: inherit; }
button { margin-top: 16px; background: #e6b36a; color: #1b1408; cursor: pointer; }
</style></head><body><main><h1>Litt</h1><form action="/auth/login" method="get">
<label for="name">Name</label><input id="name" name="name" pattern="[A-Za-z0-9_-]{1,20}" maxlength="20" required autocomplete="nickname" autofocus>
<input type="hidden" name="next" value="${escapeHtml(next)}"><button type="submit">Sign in</button>
</form></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  return {
    handleLogin,
    handleCallback: handleLogin,
    async handleLogout() {
      return new Response(null, { status: 204, headers: { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
    },
    async getSessionUser(req) {
      const url = new URL(req.url);
      const name = url.searchParams.has("devUser") ? url.searchParams.get("devUser") : cookieName(req);
      return name !== null && isValidName(name) ? remember(name) : null;
    },
    async recordGame(record) {
      if (games.has(record.id)) return;
      games.set(record.id, structuredClone(record));
      for (const player of record.players) {
        if (!users.has(player.id)) users.set(player.id, { id: player.id, displayName: player.id.replace(/^dev:/, ""), avatarUrl: null });
      }
    },
    async getStats(userId) {
      const user = users.get(userId);
      if (!user) return null;
      const stats: PlayerStats = { ...user, played: 0, wins: 0, losses: 0, draws: 0 };
      for (const game of games.values()) {
        const player = game.players.find((seat) => seat.id === userId);
        if (!player) continue;
        stats.played++;
        if (game.result === "draw") stats.draws++;
        else if (game.result === player.team) stats.wins++;
        else stats.losses++;
      }
      return stats;
    },
    async getLeaderboard() {
      const leaderboard = await Promise.all([...users.keys()].map((id) => this.getStats(id)));
      return leaderboard.filter((stats): stats is PlayerStats => stats !== null)
        .sort((first, second) => second.wins - first.wins || first.displayName.localeCompare(second.displayName));
    },
  };
}
