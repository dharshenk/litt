import type { PlayerStats, UserProfile } from "@litt/protocol";
import type { Accounts, AccountsOptions, FinishedGameRecord, SqlDb } from "./types.js";

const OAUTH_COOKIE = "litt_oauth";
const SESSION_COOKIE = "litt_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const PROFILE_URL = "https://discord.com/api/users/@me";

interface OAuthState {
  state: string;
  next: string;
}

interface DiscordProfile {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

interface UserRow {
  discord_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
}

interface StatsRow extends UserRow {
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function safeNext(value: string | null, publicBaseUrl: string): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const resolved = new URL(value, publicBaseUrl);
    return resolved.origin === new URL(publicBaseUrl).origin
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : "/";
  } catch {
    return "/";
  }
}

function secureAttribute(publicBaseUrl: string): string {
  return new URL(publicBaseUrl).protocol === "https:" ? "; Secure" : "";
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapUser(row: UserRow): UserProfile {
  return { id: row.discord_id, displayName: row.display_name, avatarUrl: row.avatar };
}

function mapStats(row: StatsRow): PlayerStats {
  return {
    ...mapUser(row),
    played: Number(row.played),
    wins: Number(row.wins),
    losses: Number(row.losses),
    draws: Number(row.draws),
  };
}

async function upsertUser(db: SqlDb, profile: DiscordProfile, now: number): Promise<void> {
  await db.run(
    `INSERT INTO users (discord_id, username, display_name, avatar, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET
       username = excluded.username,
       display_name = excluded.display_name,
       avatar = excluded.avatar,
       last_seen = excluded.last_seen`,
    [profile.id, profile.username, profile.global_name ?? profile.username, profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128` : null, now, now],
  );
}

const STATS_QUERY = `
  SELECT u.discord_id, u.username, u.display_name, u.avatar,
    COUNT(g.id) AS played,
    COALESCE(SUM(CASE WHEN g.result = gp.team THEN 1 ELSE 0 END), 0) AS wins,
    COALESCE(SUM(CASE WHEN g.result = 'draw' THEN 1 ELSE 0 END), 0) AS draws,
    COALESCE(SUM(CASE WHEN g.result != 'draw' AND g.result != gp.team THEN 1 ELSE 0 END), 0) AS losses
  FROM users u
  LEFT JOIN game_players gp ON gp.discord_id = u.discord_id
  LEFT JOIN games g ON g.id = gp.game_id
`;

export function createAccounts(options: AccountsOptions): Accounts {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const callbackUrl = new URL("/auth/callback", options.publicBaseUrl).toString();
  const secure = secureAttribute(options.publicBaseUrl);

  async function sign(payload: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(options.sessionSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
  }

  return {
    async handleLogin(req) {
      const url = new URL(req.url);
      const stateBytes = crypto.getRandomValues(new Uint8Array(32));
      const state = bytesToBase64Url(stateBytes);
      const oauthState: OAuthState = { state, next: safeNext(url.searchParams.get("next"), options.publicBaseUrl) };
      const stateCookie = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(oauthState)));
      const authorize = new URL("https://discord.com/oauth2/authorize");
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("client_id", options.discordClientId);
      authorize.searchParams.set("scope", "identify");
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("prompt", "none");
      authorize.searchParams.set("redirect_uri", callbackUrl);
      return redirect(authorize.toString(), [`${OAUTH_COOKIE}=${stateCookie}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600${secure}`]);
    },

    async handleCallback(req) {
      const url = new URL(req.url);
      if (url.searchParams.has("error")) return redirect("/?login=cancelled");

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const cookie = cookieValue(req, OAUTH_COOKIE);
      let oauthState: OAuthState | null = null;
      try {
        if (cookie) {
          const decoded: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(cookie)));
          if (jsonObject(decoded) && typeof decoded.state === "string" && typeof decoded.next === "string") {
            oauthState = { state: decoded.state, next: safeNext(decoded.next, options.publicBaseUrl) };
          }
        }
      } catch {
        oauthState = null;
      }
      if (!code || !returnedState || !oauthState || returnedState !== oauthState.state) {
        return new Response("Invalid OAuth state", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
      }

      try {
        const tokenResponse = await fetcher(TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: callbackUrl,
            client_id: options.discordClientId,
            client_secret: options.discordClientSecret,
          }),
        });
        if (!tokenResponse.ok) throw new Error("Discord token exchange failed");
        const tokenBody: unknown = await tokenResponse.json();
        if (!jsonObject(tokenBody) || typeof tokenBody.access_token !== "string" || tokenBody.access_token.length === 0) {
          throw new Error("Discord token response was invalid");
        }

        const profileResponse = await fetcher(PROFILE_URL, {
          headers: { authorization: `Bearer ${tokenBody.access_token}` },
        });
        if (!profileResponse.ok) throw new Error("Discord profile request failed");
        const profileBody: unknown = await profileResponse.json();
        if (!jsonObject(profileBody) || typeof profileBody.id !== "string" || typeof profileBody.username !== "string") {
          throw new Error("Discord profile response was invalid");
        }
        const profile: DiscordProfile = {
          id: profileBody.id,
          username: profileBody.username,
          global_name: typeof profileBody.global_name === "string" ? profileBody.global_name : null,
          avatar: typeof profileBody.avatar === "string" ? profileBody.avatar : null,
        };
        const timestamp = now();
        await upsertUser(options.db, profile, timestamp);

        const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ sub: profile.id, exp: Math.floor(timestamp / 1000) + SESSION_SECONDS })));
        const session = `${payload}.${await sign(payload)}`;
        return redirect(oauthState.next, [
          `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}${secure}`,
          `${OAUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0${secure}`,
        ]);
      } catch {
        return new Response("Discord authentication failed", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    },

    async handleLogout() {
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}` },
      });
    },

    async getSessionUser(req) {
      try {
        const session = cookieValue(req, SESSION_COOKIE);
        if (!session) return null;
        const separator = session.lastIndexOf(".");
        if (separator <= 0 || separator === session.length - 1) return null;
        const payload = session.slice(0, separator);
        const signature = toArrayBuffer(base64UrlToBytes(session.slice(separator + 1)));
        const key = await crypto.subtle.importKey(
          "raw", new TextEncoder().encode(options.sessionSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
        );
        const valid = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(payload));
        if (!valid) return null;
        const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
        if (!jsonObject(parsed) || typeof parsed.sub !== "string" || typeof parsed.exp !== "number" || parsed.exp <= Math.floor(now() / 1000)) return null;
        const row = await options.db.first<UserRow>(
          "SELECT discord_id, username, display_name, avatar FROM users WHERE discord_id = ?",
          [parsed.sub],
        );
        return row ? mapUser(row) : null;
      } catch {
        return null;
      }
    },

    async recordGame(record: FinishedGameRecord) {
      await options.db.run(
        `INSERT OR IGNORE INTO games (id, started_at, ended_at, wrong_declaration, history_limit, score_a, score_b, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.startedAt, record.endedAt, record.config.wrongDeclaration, record.config.historyLimit, record.scores.A, record.scores.B, record.result],
      );
      for (const player of record.players) {
        await options.db.run(
          "INSERT OR IGNORE INTO game_players (game_id, discord_id, team) VALUES (?, ?, ?)",
          [record.id, player.id, player.team],
        );
      }
    },

    async getStats(userId) {
      const row = await options.db.first<StatsRow>(`${STATS_QUERY} WHERE u.discord_id = ? GROUP BY u.discord_id`, [userId]);
      return row ? mapStats(row) : null;
    },

    async getLeaderboard() {
      const rows = await options.db.all<StatsRow>(
        `${STATS_QUERY}
         GROUP BY u.discord_id
         HAVING COUNT(g.id) > 0
         ORDER BY wins DESC, CAST(wins AS REAL) / COUNT(g.id) DESC, u.display_name COLLATE NOCASE ASC`,
      );
      return rows.map(mapStats);
    },
  };
}
