import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const SERVER = "localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Keep the browser-facing Host header: the server rejects state-changing requests whose Origin doesn't match it.
    proxy: {
      "/api": { target: `http://${SERVER}`, changeOrigin: false },
      "/auth": { target: `http://${SERVER}`, changeOrigin: false },
      "/ws": { target: `ws://${SERVER}`, ws: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
