import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const SERVER = "localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://${SERVER}`,
      "/auth": `http://${SERVER}`,
      "/ws": { target: `ws://${SERVER}`, ws: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
