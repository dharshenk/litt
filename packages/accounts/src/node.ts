import Database from "better-sqlite3";
import type { SqlDb } from "./types.js";
import { migrate } from "./schema.js";

export interface BetterSqliteDb extends SqlDb {
  close(): void;
}

export async function createBetterSqliteDb(filename: string): Promise<BetterSqliteDb> {
  const database = new Database(filename);
  database.pragma("journal_mode = WAL");
  const db: BetterSqliteDb = {
    async run(sql, params = []) {
      database.prepare(sql).run(...params as never[]);
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return database.prepare(sql).all(...params as never[]) as T[];
    },
    async first<T>(sql: string, params: unknown[] = []) {
      return (database.prepare(sql).get(...params as never[]) as T | undefined) ?? null;
    },
    close() {
      database.close();
    },
  };
  try {
    await migrate(db);
    return db;
  } catch (error) {
    database.close();
    throw error;
  }
}
