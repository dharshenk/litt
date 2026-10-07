import type { SqlDb } from "./types.js";

export interface D1Result<T> {
  results?: T[];
  success?: boolean;
  error?: string;
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(columnName?: string): Promise<T | null>;
}

export interface D1Like {
  prepare(sql: string): D1StatementLike;
}

export function fromD1(d1: D1Like): SqlDb {
  return {
    async run(sql, params = []) {
      const result = await d1.prepare(sql).bind(...params).run();
      if (result.success === false) throw new Error(result.error ?? "D1 query failed");
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const result = await d1.prepare(sql).bind(...params).all<T>();
      if (result.success === false) throw new Error(result.error ?? "D1 query failed");
      return result.results ?? [];
    },
    async first<T>(sql: string, params: unknown[] = []) {
      return d1.prepare(sql).bind(...params).first<T>();
    },
  };
}
