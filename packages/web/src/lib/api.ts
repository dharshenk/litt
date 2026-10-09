import type { CreateRoomResponse, PlayerStats, UserProfile } from "@litt/protocol";
import { readStorage, writeStorage } from "./storage.js";

// ---------- Dev identity (dev builds only; see tasks/README.md "Dev identity") ----------

const DEV_USER_KEY = "litt_dev_user";
export const DEV_NAME_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

export function getDevUser(): string | null {
  if (!import.meta.env.DEV) return null;
  return readStorage("session", DEV_USER_KEY);
}

export function setDevUser(name: string | null): void {
  if (!import.meta.env.DEV) return;
  writeStorage("session", DEV_USER_KEY, name);
}

/** Path for an /api/* request, with the dev identity appended in dev builds. */
export function apiUrl(path: string): string {
  const dev = getDevUser();
  if (!dev) return path;
  return `${path}${path.includes("?") ? "&" : "?"}devUser=${encodeURIComponent(dev)}`;
}

/** Absolute ws(s):// URL on the current origin for a /ws/* path. */
export function wsUrl(path: string): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}${apiUrl(path)}`;
}

export function loginUrl(next: string, provider?: "discord" | "google"): string {
  return `/auth/login?next=${encodeURIComponent(next)}${provider ? `&provider=${provider}` : ""}`;
}

// ---------- HTTP API ----------

export interface Api {
  /** null when not logged in (401). */
  me(): Promise<UserProfile | null>;
  createRoom(): Promise<CreateRoomResponse>;
  logout(): Promise<void>;
  stats(): Promise<PlayerStats[]>;
  /** Mock mode intercepts the Discord login link; the real API lets it navigate. */
  interceptLogin?: () => Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: "same-origin", ...init });
  if (!res.ok) throw new HttpError(res.status, `Request failed (${res.status})`);
  return (await res.json()) as T;
}

const httpApi: Api = {
  async me() {
    try {
      return await request<UserProfile>("/api/me");
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) return null;
      throw e;
    }
  },
  createRoom: () => request<CreateRoomResponse>("/api/rooms", { method: "POST" }),
  async logout() {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    setDevUser(null);
  },
  stats: () => request<PlayerStats[]>("/api/stats"),
};

let impl: Api = httpApi;

/** Mock mode swaps in a fake implementation before the app renders. */
export function setApi(next: Api): void {
  impl = next;
}

export const api: Api = {
  me: () => impl.me(),
  createRoom: () => impl.createRoom(),
  logout: () => impl.logout(),
  stats: () => impl.stats(),
  get interceptLogin() {
    return impl.interceptLogin;
  },
};
