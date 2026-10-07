# Task 03 — Web client (`@litt/web`)

## Context

Litt is a web version of a 54-card, 9-set, two-team Literature-style card game. Groups of 6–12 friends play it while talking in a Discord voice channel. One person creates a room and pastes the link into Discord, and everyone joins in their browser.

The server is authoritative and sends each player only their own `PlayerView`.

Other agents are building the engine, server and accounts **in parallel**, so you build against the contract types plus a **mock server** of your own.

**A high-fidelity design exists and is the source of truth for everything visual.** This file defines behaviour and data flow. `design/README.md` defines look, layout and motion.

Read first:
- `tasks/README.md`;
- `rules.md` (the whole thing, to understand the game, plus §34);
- `ARCHITECTURE.md` §7;
- **`design/README.md`** (tokens, type, screens, motion);
- the contracts:
  - `packages/protocol/src/index.ts` (HTTP routes, WebSocket messages, `RoomSnapshot`)
  - `packages/engine/src/types.ts` (`PlayerView`, `Phase`, `GameEvent`, `SetResolution`, …)
  - `packages/engine/src/cards.ts`

Then **open the design files in a browser**. Keep `support.js` next to them.
- `design/Litt Prototype.dc.html` is a playable prototype. Use its bottom-left **PROTOTYPE** panel to see every state, and the Tweaks for theme and phone layout.
- `design/Litt Mockups.dc.html` has static boards of the main screens (1a–1g).

**Recreate the design; don't port it.** The prototype's bots, dealing and legality code are a stand-in for the server. Do not copy them. The `.dc.html` markup is a reference, not production code. Rebuild it as React components and plain CSS.

## You own

- `packages/web/**`
- `tasks/reports/03.md`
- `design/` is read-only.

## Stack

React 19, Vite 6, TypeScript, react-router 7 and Vitest with Testing Library and jsdom. These are already in `package.json` and installed.

- Plain CSS: one global stylesheet with the design tokens, plus CSS modules per component. No UI framework.
- **Fonts:** Instrument Serif, Geist and Geist Mono from Google Fonts, loaded via `<link>` in `index.html`.
- Import `cardsInSet`, `setOf`, `SET_IDS`, `isCard` and the types from `@litt/engine`.
  - Only `cards.ts` and `types.ts` are guaranteed to exist.
  - Do **not** import `apply`, `createGame` or `playerView`.

## Setup to create

- `index.html`, `vite.config.ts`, `tsconfig.json` (DOM lib, `jsx: react-jsx`), `src/main.tsx`.
- **Vite dev server proxy:** `/api` and `/auth` → `http://localhost:8787`; `/ws` → `ws://localhost:8787` with `ws: true`.
- Vitest uses the jsdom environment.

## Theming

- Define every token from the `design/README.md` table as a CSS variable on `:root`. Dark values are the default.
- Light values apply under `@media (prefers-color-scheme: light)`, and also under `:root[data-theme="light"]`.
- `:root[data-theme="dark"]` forces dark.
- The app follows the system theme by default. A small theme toggle is optional; if you add one, store the choice in `localStorage` inside a try/catch.

## Pages and features

Layout, sizes, copy and motion for each screen are in `design/README.md` → *Screens*. The behaviour required on top of that follows.

### Home `/`

- `GET /api/me`.
- **If 401:** show "Log in with Discord", linking to `/auth/login?next=<current path>`.
- **If logged in:**
  - "Create room" (`POST /api/rooms`, then navigate to `/r/:code`);
  - room-code input with "Join";
  - avatar, name and "Log out" (`POST /auth/logout`).
- Leaderboard from `GET /api/stats`.
- **Dev builds only** (`import.meta.env.DEV`): show a "Dev login" name input as well. This is not in the design; style it like the room-code input. Store the name in `sessionStorage.litt_dev_user`.
  - When it is set, append `devUser=<name>` to every `/api/*` and `/ws/*` request. See "Dev identity" in the README.
  - Put this in one `apiUrl()` / `wsUrl()` helper so it is trivially removed from production.

### Room `/r/:code`

**Connection:**
- Open a WebSocket to `/ws/rooms/:code`, using the same origin with the `ws:` or `wss:` scheme.
- Put the connection logic in a `useRoomConnection` hook built on a framework-free `RoomSocket` class:
  - JSON encode and decode;
  - reconnect with exponential backoff (0.5s → 8s max);
  - `ping` every 25s.
- Show the design's **reconnect banner**: amber "Reconnecting…", then green "Connected. You're back in your seat."
- Keep client state in one reducer over `ServerMessage`s: `room`, `view`, `turnDeadline`, an event queue and the last error.
- On reconnect, the server re-sends `room.state` and `game.view`. Events are not replayed.

**Lobby** (`status === "lobby"`):
- Implement it as designed:
  - three columns (A / B / Unassigned);
  - "Copy invite" showing "Copied ✓";
  - the host's A/B move buttons and "Randomize teams", which sends `lobby.setTeam` per player;
  - the "Table rules" panel, which sends `lobby.setConfig`: segmented wrong-declaration control, history stepper 1–10, timer chips Off/15/30/60/120;
  - "Start game", disabled with the design's reason text until the conditions are met: ≥6 players, all assigned, equal teams.
- Non-hosts see read-only controls and "Waiting for <host> to start".

**Game table** (`status === "playing"`, driven entirely by `PlayerView` + `room.players`):
- **Header:** status pill and **timer ring** from `turnDeadline`, including the ≤10s warning state.
- **Players:**
  - an opponents row and my-team row, with active highlight, "Out of cards" tags and connected dots;
  - **never show hand sizes** (the view doesn't have them).
- **Sets panel** from `view.sets`.
- **My hand:** grouped by set.
  - The group involved in the current ask or declare lifts.
  - Play the deal and card-received animations.
- **Action panel by phase:**
  - **My turn (`turn`, me):** the Ask / Declare segmented control.
    - **Ask:**
      1. Set chips: active sets I hold where I'm missing at least one card.
      2. Cards in that set I don't hold.
      3. Opponent radio list. Out-of-cards opponents are dashed and disabled.
      4. The button reads "Ask Bob for 5♥" and sends `game.ask`.
    - **Declare:**
      1. Set chips: active sets I hold at least one card of.
      2. Six rows, each with a teammate picker. My own cards are prefilled and **locked**.
      3. The button reads "Assign N more", then "Review declaration".
      4. A review modal with the mode-dependent warning (from `view.config.wrongDeclaration`), then "Declare set", which sends `game.declare`.
  - **Someone else's turn:** "Bob's turn".
  - **Choose phase, I may choose:** "Pick who plays next" list of `eligible`, which sends `game.choose`. I may choose when `chooser.player === me`, or when `chooser.team === myTeam`.
  - **Choose phase, someone else choosing:** "Waiting for X to pick who plays next" (or "Team B choosing").
  - **Recent transfers:** from `view.recentTransfers`, numbered by `seq`, newest first, with the latest tagged "Now".
- **Events:**
  - `askSucceeded` and `askFailed` drive the **ask spotlight**. Follow the design's timing: "Asking…" for 0.7s, then the result, fading out at 3.2s. It must have `aria-live`.
  - `declared`, `turnChanged`, `timedOut` and `gameOver` show as **toasts**: at most 2 at once, auto-dismissed after 6s. Word them for humans, e.g. "Maya declared Low ♥ — correct. Team A +1".
  - Server `error` messages show as a toast in the `--bad` colour.
- **Phones (<820px):**
  - compact header;
  - transfers inline above the hand;
  - a bottom bar with Ask / Declare (or "Pick who plays next") that opens the action panel as a bottom sheet over a scrim.
- **Sounds:** keep these simple, using Web Audio oscillators and no audio files. Play them for: your turn, card received, failed ask, correct and wrong declaration, and the timer tick in the last 5s. The header has a mute toggle, stored in `localStorage` inside a try/catch.

Implement the ask and declare legality rules as pure functions in `src/game/legal.ts`, with unit tests.

**Game over** (`status === "finished"` or phase `over`):
- Follow the design:
  - the kicker reads "You won" / "You lost" / "Final";
  - the result reads "Team A wins." / "It's a draw.";
  - the big score is shown in team colours.
- The meta line is built from:
  - nulls: the count of `NULL` in `view.resolutions`;
  - transfers: `view.transferCount`;
  - minutes: `room.endedAt - room.startedAt`.
- "How the sets fell" comes from `view.resolutions`, in declared order: who declared each set and its status chip.
- The host gets "Rematch", which sends `room.rematch`. Everyone gets "Back to home".

### General UI requirements

- Match the design at desktop width (≥1340px and around 1024px) and at 360–390px phones, in both themes. No horizontal scroll.
- Keyboard accessible: buttons are buttons, segmented controls and radio lists are proper radio groups, and modals and sheets trap focus and close on Esc.
- Respect `prefers-reduced-motion`: disable the deal, pulse and spotlight motion, keeping instant state changes.

## Mock mode (required, for independent development)

`src/mock/` contains an in-browser fake implementing the same `RoomSocket` interface and fake `/api` responses. It is enabled by `?mock=1` or `VITE_MOCK=1`.

- Recreate the prototype's **PROTOTYPE** dev panel, a floating panel to jump between scenarios. Scenarios:
  - home, logged out and logged in;
  - lobby, as host and as non-host, both before and once the game can start;
  - my turn (ask and declare);
  - someone else's turn;
  - a successful and a failed ask spotlight;
  - a correct and a wrong declaration;
  - a choose phase, with me choosing and someone else choosing;
  - out-of-cards players;
  - the timer warning;
  - reconnecting;
  - game over (win, loss and draw).
- Use hand-written fixture `PlayerView`s and `RoomSnapshot`s. Do not use the real engine and do not port the prototype's bots.

## Tests

- `legal.ts` unit tests.
- Reducer tests: every `ServerMessage`, and reconnect behaviour.
- `RoomSocket` backoff and ping, with a fake `WebSocket` and fake timers.
- Component smoke tests:
  - the lobby renders host vs non-host controls, and the start-disabled reasons;
  - the table renders the hand grouped by set;
  - the ask panel only offers legal sets, cards and targets;
  - the declare panel prefills and locks my cards;
  - the choose picker appears only for the chooser;
  - the game-over screen uses `resolutions`, `transferCount` and `startedAt`/`endedAt`.

## Out of scope

Server, engine and auth implementation, production hosting, and drag-and-drop in the lobby (the design uses buttons).

## Done when

- `npm run typecheck -w @litt/web`, `npm test -w @litt/web` and `npm run build -w @litt/web` pass.
- Every scenario is viewable in mock mode via `npm run dev -w @litt/web` + `?mock=1`.
- The screens visually match the design files side by side at desktop and phone widths, in dark and light.
- `tasks/reports/03.md` is written. Include screenshots of each mock scenario if you can take them, and list any place you deliberately deviated from the design and why.
