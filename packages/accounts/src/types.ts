// CONTRACT FILE — interface between @litt/accounts and @litt/server.
// Do not change without agreement; see tasks/README.md ("Contract changes").

import type { GameConfig, Team } from "@litt/engine";
import type { PlayerStats, UserProfile } from "@litt/protocol";

/**
 * Minimal async SQL interface (SQLite dialect) that both Cloudflare D1 and a
 * better-sqlite3 wrapper can satisfy. Params are positional `?` placeholders.
 */
export interface SqlDb {
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface FinishedGameRecord {
  id: string;
  /** Epoch milliseconds. */
  startedAt: number;
  endedAt: number;
  config: GameConfig;
  result: Team | "draw";
  scores: Record<Team, number>;
  players: { id: string; team: Team }[];
}

export interface AccountsOptions {
  db: SqlDb;
  discordClientId: string;
  discordClientSecret: string;
  /** Used to HMAC-sign session cookies. */
  sessionSecret: string;
  /** e.g. "http://localhost:8787" — used to build the OAuth redirect URI. */
  publicBaseUrl: string;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

/** Everything is web-standard Request/Response so it runs on Node and Workers. */
export interface Accounts {
  handleLogin(req: Request): Promise<Response>;
  handleCallback(req: Request): Promise<Response>;
  handleLogout(req: Request): Promise<Response>;
  /** Reads and verifies the session cookie. null if absent, invalid or expired. */
  getSessionUser(req: Request): Promise<UserProfile | null>;
  recordGame(record: FinishedGameRecord): Promise<void>;
  getStats(userId: string): Promise<PlayerStats | null>;
  getLeaderboard(): Promise<PlayerStats[]>;
}
