import { afterEach, describe, expect, it, vi } from "vitest";
import { fromD1, type D1Like, type D1Result, type D1StatementLike } from "../src/d1.js";
import { createBetterSqliteDb } from "../src/node.js";
import { SCHEMA_SQL } from "../src/schema.js";

afterEach(() => vi.restoreAllMocks());

describe("fromD1", () => {
  it("binds positional params and returns run, all and first results", async () => {
    const calls: { sql: string; params: unknown[]; method?: string }[] = [];
    const d1: D1Like = {
      prepare(sql) {
        const call = { sql, params: [] as unknown[], method: undefined as string | undefined };
        calls.push(call);
        const statement: D1StatementLike = {
          bind(...params) { call.params = params; return statement; },
          async run<T>() { call.method = "run"; return { success: true } as D1Result<T>; },
          async all<T>() { call.method = "all"; return { success: true, results: [{ value: 2 }] as T[] }; },
          async first<T>() { call.method = "first"; return { value: 3 } as T; },
        };
        return statement;
      },
    };
    const db = fromD1(d1);
    await db.run("UPDATE things SET value = ?", [1]);
    expect(await db.all<{ value: number }>("SELECT value FROM things WHERE id = ?", [4])).toEqual([{ value: 2 }]);
    expect(await db.first<{ value: number }>("SELECT value FROM things WHERE id = ?", [5])).toEqual({ value: 3 });
    expect(calls).toEqual([
      { sql: "UPDATE things SET value = ?", params: [1], method: "run" },
      { sql: "SELECT value FROM things WHERE id = ?", params: [4], method: "all" },
      { sql: "SELECT value FROM things WHERE id = ?", params: [5], method: "first" },
    ]);
  });

  it("surfaces D1 errors instead of returning empty success values", async () => {
    const d1: D1Like = {
      prepare() {
        const statement: D1StatementLike = {
          bind() { return statement; },
          async run() { return { success: false, error: "write denied" }; },
          async all() { return { success: false, error: "read denied" }; },
          async first() { throw new Error("first denied"); },
        };
        return statement;
      },
    };
    const db = fromD1(d1);
    await expect(db.run("UPDATE x")).rejects.toThrow("write denied");
    await expect(db.all("SELECT * FROM x")).rejects.toThrow("read denied");
    await expect(db.first("SELECT * FROM x")).rejects.toThrow("first denied");
  });
});

describe("better-sqlite3 adapter", () => {
  it("opens an in-memory database, migrates it, and implements the SqlDb methods", async () => {
    const db = await createBetterSqliteDb(":memory:");
    try {
      await db.run("INSERT INTO users (discord_id, username, display_name, avatar, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)", ["sqlite-user", "name", "Name", null, 1, 2]);
      expect(await db.first("SELECT discord_id, display_name FROM users WHERE discord_id = ?", ["sqlite-user"])).toEqual({ discord_id: "sqlite-user", display_name: "Name" });
      expect(await db.all("SELECT discord_id FROM users")).toEqual([{ discord_id: "sqlite-user" }]);
      expect((await db.first<{ journal_mode: string }>("PRAGMA journal_mode"))?.journal_mode).toBe("memory");
      expect(SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS game_players");
    } finally {
      db.close();
    }
  });
});
