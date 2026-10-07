import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { installViewport, resetViewport } from "./viewport.js";

installViewport();

afterEach(() => {
  cleanup();
  resetViewport();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});
