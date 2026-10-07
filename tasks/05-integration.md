# Task 05 — Integration, dev workflow, end-to-end test

## Context

Litt is a web version of a 54-card, 9-set, two-team Literature-style card game that friends play over Discord voice. Four packages were built in parallel against shared contracts:

- `@litt/engine`: rules (Task 01)
- `@litt/server`: rooms, HTTP, Node adapter (Task 02)
- `@litt/web`: React client (Task 03)
- `@litt/accounts`: Discord login and stats (Task 04)

Your job is to make them work together as one app that a person can run locally and play end to end, and to prove that with an automated test.

**Run this task only after Tasks 01–04 are finished.**

Read first:
- `tasks/README.md`, `rules.md` §34, `ARCHITECTURE.md`;
- **all four reports** in `tasks/reports/`;
- `tasks/CONTRACT_CHANGES.md`.

## You own

- Repository root files.
- Glue changes in any package. Keep them minimal, and list every file you touched outside the root in your report.
- `tasks/reports/05.md`

## Steps

### 1. Resolve contract change requests

- Go through each entry in `tasks/CONTRACT_CHANGES.md`. Either apply it, updating every package affected, or reject it with a reason. Record the decision under the entry.
- Remove any workarounds that are no longer needed.

### 2. Make everything typecheck and pass

- `npm run typecheck` and `npm test` from the root must pass for all packages, including `packages/server/src/node/main.ts`, which was allowed to fail earlier.
- Fix integration mismatches:
  - import paths;
  - the `@litt/accounts/node` subpath export;
  - the engine's `index.ts` exports;
  - message shapes.

### 3. Dev workflow — root `package.json` scripts

- **`npm run dev`** runs the server (`tsx watch`, port 8787) and the Vite dev server together. Use `concurrently` as a root devDependency.
  - It uses dev accounts when `DISCORD_CLIENT_ID` is unset.
  - Opening several tabs with different dev names must give a playable 6-player game.
- **`npm run build`** builds the web client.
- **`npm start`** is production mode:
  - The Node server serves `packages/web/dist` as static files, with an SPA fallback to `index.html` for `/r/*` and `/`.
  - It requires the `DISCORD_*` and `SESSION_SECRET` environment variables, and **refuses to start** if they are missing when `NODE_ENV=production`.
- Add `.env.example` listing every environment variable:
  - `PORT`
  - `PUBLIC_BASE_URL`
  - `DISCORD_CLIENT_ID`
  - `DISCORD_CLIENT_SECRET`
  - `SESSION_SECRET`
  - `DATABASE_PATH`
  - `NODE_ENV`
- Load `.env` in development, e.g. with `node --env-file` or `tsx`.

### 4. E2E dev tools (test only)

- Add a dev-only endpoint `GET /api/dev/rooms/:code/state` that returns the full `GameState`. It is used only by the E2E test to choose legal moves.
- Register it **only** when `LITT_DEV_TOOLS=1` **and** `NODE_ENV !== "production"`.
- Add a test asserting it returns 404 in production mode.

### 5. Playwright end-to-end test (`e2e/`)

- Add `@playwright/test` to the root and use Chromium only.
- `playwright.config.ts` starts the app with `npm run dev`-equivalent servers and `LITT_DEV_TOOLS=1`.
- **Scenario:**
  1. Six browser contexts, with dev users `alice`, `bob`, `carol`, `dave`, `erin` and `frank`.
  2. Alice creates a room and the others join through the invite link.
  3. Alice assigns 3v3 teams, sets the timer off and "award" mode, and starts.
  4. The test loop reads the full state from the dev endpoint and makes the active player act **through the UI**:
     - usually a legal ask;
     - a **correct** declaration whenever a team holds a full set it can declare.
  5. Within the loop, make at least one failed ask and one choose-phase selection.
  6. Play until the game is over.
- **Assertions:**
  - every page shows the same score after each step;
  - no page ever displays another player's hand cards in the "my hand" area;
  - the game-over banner shows on all six pages;
  - after the game, `GET /api/stats` shows 6 players with 1 game each.
- Add a second, short test: a player reloads mid-game, gets the same seat and hand back, and the game continues.
- **Visual check:** during the scripted game, take screenshots at 1440px and 390px, in dark and light themes, of the lobby, my turn, the ask spotlight, the declare review, the choose phase and game over. Compare them by eye with `design/`, and list any mismatches in your report. This is not a pixel-diff gate.

### 6. Documentation

- Root `README.md`:
  - what Litt is;
  - quick start (`npm install`, `npm run dev`, open several tabs with different dev names);
  - how to set up Discord login (steps from the Task 04 report);
  - the scripts;
  - the project layout;
  - links to `rules.md`, `ARCHITECTURE.md` and `tasks/`.
- Update `ARCHITECTURE.md` wherever the implementation diverged.

### 7. Hygiene

- Run `npm audit`. Report the findings and fix those fixable without breaking changes. Never use `--force`.
- Remove leftover TODOs that were meant for Tasks 01–04.
- Make sure `.gitignore` covers `*.db`, `.env`, `test-results/` and `playwright-report/`.

## Out of scope

Choosing or deploying to a host (still undecided; that will be a separate task), the Cloudflare adapter, new gameplay features.

## Done when

- From a clean checkout:
  - `npm install`, `npm run typecheck`, `npm test` and `npx playwright test` all pass;
  - `npm run dev` lets a person play a full game in 6 tabs.
- `tasks/reports/05.md` is written, including:
  - test results;
  - contract decisions;
  - files touched;
  - a manual play-test checklist;
  - a list of known issues.
