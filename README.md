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

When `DISCORD_CLIENT_ID` is unset, development uses the per-tab dev identity. The Node server refuses to use dev accounts when `NODE_ENV=production`.

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

Production startup requires a prior `npm run build` and `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, and `NODE_ENV=production`. `PORT`, `PUBLIC_BASE_URL`, and `DATABASE_PATH` are optional; defaults are documented in `.env.example`.

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