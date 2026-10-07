import type { SqlDb } from "./types.js";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  wrong_declaration TEXT NOT NULL CHECK (wrong_declaration IN ('award', 'null')),
  history_limit INTEGER NOT NULL CHECK (history_limit BETWEEN 1 AND 10),
  score_a INTEGER NOT NULL,
  score_b INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('A', 'B', 'draw'))
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  team TEXT NOT NULL CHECK (team IN ('A', 'B')),
  PRIMARY KEY (game_id, discord_id)
);

CREATE INDEX IF NOT EXISTS game_players_discord_id_idx ON game_players(discord_id);
`;

export async function migrate(db: SqlDb): Promise<void> {
  for (const statement of SCHEMA_SQL.split(";").map((sql) => sql.trim()).filter(Boolean)) {
    await db.run(statement);
  }
}
