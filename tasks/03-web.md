# Task 03 — Web client (`@litt/web`)

## Context

Litt is a web version of a 54-card, 9-set, two-team Literature-style card game. Groups of 6–12 friends play it while talking in a Discord voice channel. One person creates a room and pastes the link into Discord, and everyone joins in their browser.

The server is authoritative and sends each player only their own `PlayerView`.

Other agents are building the engine, server and accounts **in parallel**, so you build against the contract types plus a **mock server** of your own.

Read first: `tasks/README.md`, `rules.md` (the whole thing, to understand the game, plus §34), `ARCHITECTURE.md` §7, and the contracts:
- `packages/protocol/src/index.ts` (HTTP routes and WebSocket messages)
- `packages/engine/src/types.ts` (`PlayerView`, `Phase`, `GameEvent`, …)
- `packages/engine/src/cards.ts`

## You own

- `packages/web/**`
- `tasks/reports/03.md`

## Stack

React 19, Vite 6, TypeScript, react-router 7 and Vitest with Testing Library and jsdom. These are already in `package.json` and installed.

- Plain CSS: CSS modules or one stylesheet with CSS variables. No UI framework.
- Import `cardsInSet`, `setOf`, `SET_IDS`, `isCard` and the types from `@litt/engine`.
  - Only `cards.ts` and `types.ts` are guaranteed to exist.
  - Do **not** import `apply`, `createGame` or `playerView`.

## Setup to create

- `index.html`, `vite.config.ts`, `tsconfig.json` (DOM lib, `jsx: react-jsx`), `src/main.tsx`.
- **Vite dev server proxy:** `/api` and `/auth` → `http://localhost:8787`; `/ws` → `ws://localhost:8787` with `ws: true`.
- Vitest uses the jsdom environment.

## Pages and features

### Home `/`

- `GET /api/me`.
- **If 401:** show a "Log in with Discord" button linking to `/auth/login?next=<current path>`.
- **If logged in:**
  - avatar and name, and log out (`POST /auth/logout`);
  - "Create room" (`POST /api/rooms`, then navigate to `/r/:code`);
  - "Join room" code input, uppercased;
  - leaderboard from `GET /api/stats`: name, played, W/L/D, win %.
- **Dev builds only** (`import.meta.env.DEV`): show a "Dev login" name input as well. Store the name in `sessionStorage.litt_dev_user`.
  - When it is set, append `devUser=<name>` to every `/api/*` and `/ws/*` request. See "Dev identity" in the README.
  - This lets one person open 6 tabs as 6 players.
  - Put this in one `apiUrl()` / `wsUrl()` helper so it is trivially removed from production.

### Room `/r/:code`

**Connection:**
- Open a WebSocket to `/ws/rooms/:code`, using the same origin with the `ws:` or `wss:` scheme.
- Put the connection logic in a small `useRoomConnection` hook built on a framework-free `RoomSocket` class:
  - JSON encode and decode;
  - reconnect with exponential backoff (0.5s → 8s max) and a visible "Reconnecting…" banner;
  - `ping` every 25s.
- Keep client state in one reducer over `ServerMessage`s: `room`, `view`, `turnDeadline`, an event toast queue and the last error.
- On reconnect, the server re-sends `room.state` and `game.view`. Events are not replayed.

**Lobby** (`status === "lobby"`):
- Show three columns: Team A, Team B, Unassigned. Each player shows avatar, name, a host crown and a connected dot.
- A copyable invite link (`location.href`).
- **Host-only controls:**
  - move a player between columns (buttons are fine; drag-and-drop is optional);
  - a "Randomize teams" button, which sends `lobby.setTeam` for each player;
  - a config form, which sends `lobby.setConfig`:
    - wrong declaration: "Award to opponents" / "Nullify set";
    - history limit (1–10, default 3);
    - turn timer: off, or 15–600 s;
  - a **Start** button, disabled with the reason shown until there are ≥6 players, everyone is assigned, and the teams are equal.
- Non-hosts see everything read-only.

**Game table** (`status === "playing"`, driven entirely by `PlayerView`):
- **Header:** score A vs B, my team, and the active player or chooser.
  - Show a countdown from `turnDeadline`, if set.
  - Show a clear "Your turn" state.
- **Players:**
  - two rows, my team and the opponents;
  - name, avatar and connected dot (from `room.players`);
  - an "out of cards" badge and an active-player highlight.
  - **No hand sizes**; the view doesn't have them (this is intentional).
- **My hand:**
  - grouped by set, with set names "Low ♥ (2–7)", "High ♠ (9–A)" and "8s & Jokers";
  - rendered as readable cards with rank and suit symbol, red ♥/♦, and Jokers. CSS/Unicode is fine; no image assets are needed.
- **Sets panel:** all 9 sets with status — active, won by A, won by B, or null.
- **Recent transfers:** the last N from `recentTransfers`, shown as "Bob → Alice: 5♥", newest first.
- **Event toasts**, auto-dismissed after about 6s, worded for humans:
  - `askFailed`: "Alice asked Bob for Q♠ — Bob doesn't have it. Bob's turn."
  - `askSucceeded`, `declared` (correct or wrong, plus the outcome), `turnChanged`, `timedOut`, `gameOver`.
- **Errors:** `error` messages show as a red toast.

**Ask flow** (only when the phase is `turn` and I am the player):
1. Pick a card. Offer only cards that are in a set I hold at least one card of, that set is `ACTIVE`, and I don't hold the card.
2. Pick an opponent. Offer only opponents who are not out of cards.
3. Confirm. This sends `game.ask`.

Implement these legality rules as pure functions in `src/game/legal.ts`, with unit tests.

**Declare flow** (only on my turn):
1. Choose an active set I hold at least one card of.
2. For each of its 6 cards, pick which teammate holds it. My own cards are prefilled with me.
3. Review the summary: "This cannot be undone. A wrong declaration gives the set to the other team / nullifies it." Use the room config to pick the wording.
4. Send `game.declare` with the assignment.

**Choose phase:**
- If I may choose, show a picker of the `eligible` players. I may choose if `chooser.player === me`, or if `chooser.team === myTeam`.
- Choosing sends `game.choose`.
- Everyone else sees "Waiting for <chooser> to pick who plays next".

**Game over** (`status === "finished"` or phase `over`):
- Show the result banner, the final score and each set's outcome.
- The host gets "Rematch", which sends `room.rematch`. Everyone else sees "Waiting for host".

### General UI requirements

- Works at 360px wide (phones) and on desktop. No horizontal scroll.
- Light and dark mode via `prefers-color-scheme`.
- Keyboard accessible: buttons are buttons and dialogs trap focus.
- Use a calm card-table look. Clarity beats decoration: whose turn it is and what I can do must be obvious at a glance.

## Mock mode (required, for independent development)

`src/mock/` contains an in-browser fake implementing the same `RoomSocket` interface and fake `/api` responses. It is enabled by `?mock=1` or `VITE_MOCK=1`.

- It plays scripted sequences that exercise every UI state:
  - lobby, as host and as non-host;
  - my turn and someone else's turn;
  - a successful and a failed ask;
  - a correct and a wrong declaration;
  - a choose phase, with me as chooser and as a non-chooser;
  - out-of-cards players;
  - the timer;
  - a reconnect;
  - game over.
- Hand-write fixture `PlayerView`s. Do not use the real engine.
- Add a small floating dev panel in mock mode to jump between scenarios.

## Tests

- `legal.ts` unit tests.
- Reducer tests: every `ServerMessage`, and reconnect behaviour.
- `RoomSocket` backoff and ping, with a fake `WebSocket` and fake timers.
- Component smoke tests:
  - the lobby renders host vs non-host controls;
  - the table renders the hand grouped by set;
  - the ask dialog only offers legal cards and targets;
  - the declare dialog prefills my cards;
  - the choose picker appears only for the chooser.

## Out of scope

Server, engine and auth implementation; production hosting; drag-and-drop polish; sounds and animations beyond simple CSS transitions.

## Done when

- `npm run typecheck -w @litt/web`, `npm test -w @litt/web` and `npm run build -w @litt/web` pass.
- Every scenario is viewable in mock mode via `npm run dev -w @litt/web` + `?mock=1`.
- `tasks/reports/03.md` is written, including screenshots or a description of each screen if possible.
