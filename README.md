# Litt

Litt is a browser-based, six-or-more-player Literature card game. Two equal teams compete to claim nine sets by asking opponents for cards and correctly declaring who holds every card in a set. It is designed to be played with friends over a Discord voice call.

Requires Node.js 22.12 or newer and npm.

## Quick Start

```sh
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in six tabs or browser profiles. On the home page, choose a different **Dev login** name in each tab. Create a room in one tab, copy its invite link, and open that link in the other five. No Discord credentials are needed for local play.

Optional environment settings can be copied from `.env.example` to `.env`. The server listens on port `8787`; Vite runs on port `5173` and proxies API, authentication, and WebSocket requests.

## Discord Login

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy the Application ID and client secret.
3. Under OAuth2, register `http://localhost:8787/auth/callback` and the production callback URL.
4. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and a high-entropy `SESSION_SECRET`. Set `PUBLIC_BASE_URL` to the externally visible origin and `DATABASE_PATH` to the SQLite database path.

`npm run dev` sets `NODE_ENV=development` and uses temporary, per-tab dev accounts even when Discord credentials are present in `.env`. Dev accounts let anyone sign in under any name, so they are used only when `NODE_ENV=development`; in any other mode the server refuses to start without Discord or Google OAuth credentials.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Run the Node server and Vite together. |
| `npm run build` | Build the web client into `packages/web/dist`. |
| `npm start` | Start the Node server; with `NODE_ENV=production`, serve the built SPA and require Discord credentials. |
| `npm run typecheck` | Typecheck every workspace, including the Node adapter. |
| `npm test` | Run all package unit tests. |
| `npx playwright install chromium` | Install Playwright's Chromium browser once per machine. |
| `npx playwright test` | Run the six-player browser scenarios and capture visual states. |
| `npm audit` | Check dependency advisories. |

Production startup requires a prior `npm run build`, `NODE_ENV=production`, a Discord or Google client id/secret pair, and a `SESSION_SECRET` of at least 32 characters (`openssl rand -hex 32`). `PORT`, `PUBLIC_BASE_URL`, and `DATABASE_PATH` are optional; defaults are documented in `.env.example`.

On the internet, serve Litt over HTTPS: run it behind a TLS-terminating reverse proxy (for example Caddy, nginx, or Cloudflare Tunnel) and set `PUBLIC_BASE_URL` to the `https://` origin. Session cookies are marked `Secure` and HSTS is sent only when `PUBLIC_BASE_URL` is `https://`, and the server logs a warning at startup when it is not. The proxy must forward WebSocket upgrades and preserve the `Host` header (or `PUBLIC_BASE_URL` must match the public origin), since cross-origin WebSocket handshakes and POSTs are rejected.

## Project Layout

- `packages/engine`: pure card, set, action, and player-view rules.
- `packages/protocol`: shared HTTP and WebSocket wire types.
- `packages/accounts`: Discord OAuth, signed sessions, SQLite/D1 storage, and stats.
- `packages/server`: authoritative rooms, HTTP API, Node WebSocket and static-file adapter.
- `packages/web`: React + Vite application.
- `design/`: UI mockups and playable visual reference.
- `e2e/`: Chromium end-to-end game and reconnect tests.
- `tasks/`: implementation briefs and handoff reports.

## Game and Design Docs

- [Rules](rules.md)
- [Architecture](ARCHITECTURE.md)
- [Task briefs and reports](tasks/README.md)
- [Design handoff](design/README.md)
