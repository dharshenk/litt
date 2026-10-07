import { readStorage, writeStorage } from "../lib/storage.js";

const KEY = "litt_mock";

/** Mock mode: `?mock=1` (sticky for the tab, `?mock=0` turns it off) or `VITE_MOCK=1`. */
export function mockRequested(): boolean {
  if (import.meta.env.VITE_MOCK === "1") return true;
  const param = new URLSearchParams(window.location.search).get("mock");
  if (param === "1") writeStorage("session", KEY, "1");
  if (param === "0") writeStorage("session", KEY, null);
  return readStorage("session", KEY) === "1";
}
