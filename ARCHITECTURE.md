# Litt — Architecture

> v1 architecture for the online version of the 54-card / 9-set Literature variant.
> Game rules live in [rules.md](rules.md); decisions referenced as "§34.x" are in its *Finalized Decisions* section.

---

## 1. Goals and constraints

**Goal:** a small web game that a group of friends can play together while talking in a Discord voice channel.

| Constraint | Source |
|---|---|
| Web app; the room link is shared in Discord | §34.3 |
| TypeScript throughout, no game/multiplayer framework | §34.4 |
| Free and easy to host | §34.4 |
| Login with Discord only | §34.4 |
| Players can rejoin their seat after a disconnect | §34.3 |
| Per-player win/loss stats | §34.3 |
| Optional per-turn timer | §34.2 |

**Non-goals for v1:** spectators, chat (Discord voice covers it), bots/AI players, replays, running as a Discord Activity, scale beyond a handful of concurrent rooms.

---

## 2. System overview

```text
 ┌──────────────────────┐          ┌──────────────────────────────────────────┐
 │  Browser (React SPA) │  HTTPS   │                 Server                   │
 │                      │◄────────►│  HTTP routes                             │
 │  - lobby / table UI  │          │   /auth/login, /auth/callback (Discord)  │
 │  - own hand only     │          │   /api/rooms, /api/stats                 │
 │                      │ WebSocket│                                          │
 │  - reconnect helper  │◄────────►│  Room (one per game)                     │
 └──────────────────────┘          │   - connections + seats                  │
            ▲                      │   - lobby state / game state             │
            │ OAuth redirect       │   - turn timer                           │
            ▼                      │   - calls the engine ───► @litt/engine   │
 ┌──────────────────────┐          │                          (pure rules)    │
 │  Discord OAuth2      │◄────────►│                                          │
 │  (identify scope)    │          │  Persistence: users, finished games      │
 └──────────────────────┘          └──────────────────────────────────────────┘
```

Key principle: **the server is authoritative.** Clients send *intents* ("ask Bob for 5♥"); the server validates them with the engine, updates state, and sends each player only what that player is allowed to see.

---

## 3. Repository layout

npm workspaces monorepo:

```text
litt/
├── rules.md                 game rules + finalized decisions
├── ARCHITECTURE.md          this document
├── package.json             workspace root
└── packages/
    ├── engine/              pure rules engine — no I/O, no framework
    │   ├── src/
    │   │   ├── cards.ts     card ids, set membership
    │   │   ├── types.ts     state, actions, events, config
    │   │   ├── game.ts      createGame(), apply()
    │   │   ├── view.ts      playerView() — hidden-information filter
    │   │   └── index.ts
    │   └── test/
    ├── protocol/            wire types (HTTP + WebSocket messages) — types only
    ├── accounts/            Discord OAuth, session cookies, users, game records, stats
    ├── server/              Hono HTTP app, rooms, timers, zod validation, Node adapter
    └── web/                 React + Vite client
```

Dependency direction: `web → protocol → engine`, `accounts → protocol`, `server → accounts, protocol, engine`. The engine depends on nothing.

**Contract files** shared between packages: `engine/src/cards.ts`, `engine/src/types.ts`, `protocol/src/index.ts` and `accounts/src/types.ts`. HTTP handlers use web-standard `Request`/`Response` (Hono), so they run unchanged on Node and Cloudflare Workers.

---

## 4. Rules engine (`@litt/engine`)

### 4.1 Responsibilities

- Model the deck, the 9 sets, hands, scores and turn state.
- Validate every action against [rules.md](rules.md) and §34.
- Produce the next state plus a list of events.
- Produce per-player views with hidden information removed.

It performs no I/O, holds no timers and knows nothing about sockets, Discord or databases. Randomness (shuffle, first player, random timeout target) is injected as an `rng: () => number`, so tests are deterministic.

### 4.2 Card and set model

- Cards are string ids: `"2C"`, `"10H"`, `"QS"`, `"JK1"`, `"JK2"`.
- Sets: `LOW_C|D|H|S`, `HIGH_C|D|H|S`, `EIGHTS`.
- Lookup tables give `setOf(card)` and `cardsInSet(set)`.

### 4.3 State

```ts
type Team = "A" | "B";

interface GameState {
  config: { wrongDeclaration: "award" | "null"; historyLimit: number };
  players: { id: string; team: Team }[];          // seat order
  hands: Record<string, Card[]>;                  // only cards in play
  sets: Record<SetId, "ACTIVE" | "WON_A" | "WON_B" | "NULL">;
  scores: { A: number; B: number };
  history: Transfer[];                            // trimmed to historyLimit
  phase:
    | { kind: "turn"; player: string }
    | { kind: "choose"; chooser: { player: string } | { team: Team };
        eligible: string[]; reason: ChooseReason }
    | { kind: "over"; result: Team | "draw" };
}
```

`history` holds **only** the last `historyLimit` successful transfers. Older transfers are discarded, not hidden, so they can never leak (rules §18).

### 4.4 Actions

| Action | Who | Effect |
|---|---|---|
| `ask { target, card }` | active player | Success: card moves, recorded in history, same player continues. Failure: turn passes to the target. |
| `declare { set, assignment: Record<Card, playerId> }` | active player | Resolves the set (won, awarded or null), removes its 6 cards, then enters a `choose` phase or ends the game. |
| `choose { player }` | chooser | Picks the next active player from `eligible`. |
| `timeout` | server only | Turn: pass to a random opponent who has cards. Choose phase: random eligible player. |

`apply(state, action, rng)` returns either `{ ok: true, state, events }` or `{ ok: false, error }`. Illegal actions never mutate state.

**Ask validation**, in order: game not over; actor is active; target is an opponent; target has cards (§34.1.5); the card's set is active; actor does not hold the card; actor holds a base card from the set.

**Declare validation:** actor is active; set is active; actor holds a card from the set (§34.1.3); the assignment covers exactly the set's 6 cards; every assignee is on the actor's team. A malformed declaration (e.g. naming an opponent) is **rejected**, not scored as wrong.

### 4.5 Turn hand-off after a declaration

| Situation | Who chooses | Eligible |
|---|---|---|
| Correct declaration | declarer | teammates with cards, including self (§34.1.1) |
| Correct, but the declarer's team has no cards left | opposing team | opponents with cards (§34.1.6) |
| Wrong declaration | opposing team (§34.1.2) | opponents with cards |
| Wrong, but the opposing team has no cards | declaring team (§34.1.13) | declarer's teammates with cards |
| No cards left anywhere | — | game over |

"Team chooses" means **any member of that team** may submit the choice, and the first valid one wins.

Eligibility is restricted to players who still hold cards. This covers §34.1.4: an empty-handed player can never become active, so the pass happens at choose time.

**Liveness:** an active player always has at least one legal action. If they hold every card of some set they can declare it; otherwise they can ask for a missing card. If the opponents are all empty, every remaining set must be wholly held by the active team, so a declaration is available.

### 4.6 Events

`askSucceeded`, `askFailed`, `declared { correct, outcome }`, `turnChanged`, `timedOut`, `gameOver`.

Events are broadcast once and not stored. This is how a failed ask becomes a brief, one-time notice (§34.1.8).

### 4.7 Player view (hidden information)

`playerView(state, playerId)` returns:

- the player's own hand;
- for every player: id, team and `outOfCards: boolean` (§34.1.11). **Hand sizes are never included** (§34.1.7);
- set statuses, scores, phase, config;
- the last `historyLimit` transfers;
- the total transfer count and the list of set resolutions (who declared each set, whether it was correct, and the outcome). Both are public, and the game-over screen uses them.

This is the **only** state shape that leaves the server for a game in progress. Tests assert that no other player's cards appear in it.

---

## 5. Protocol (`@litt/protocol`)

JSON over a single WebSocket per client. The authoritative definitions are in `packages/protocol/src/index.ts`; the server validates every inbound message with zod before it reaches room logic.

**Client → server**

| Message | Notes |
|---|---|
| `lobby.setTeam { playerId, team }` | host only |
| `lobby.setConfig { config }` | host only, lobby phase only |
| `lobby.start` | host only; requires ≥ 6 players and equal teams |
| `room.rematch` | host only; finished room only |
| `game.ask { target, card }` | |
| `game.declare { set, assignment }` | |
| `game.choose { player }` | |
| `ping` | responds with `pong` |

**Server → client**

| Message | Notes |
|---|---|
| `room.state { room }` | snapshot sent on connect and room changes |
| `game.view { view, turnDeadline }` | personalized; sent to each player after every game change; deadline is a number or `null` |
| `game.event { event }` | one-time notices (failed ask, declaration result, …) |
| `error { code, message }` | rejected action; sent only to the sender |
| `pong` | response to `ping` |

Full views are sent after each change instead of diffs. A view is well under 2 KB, so the simplicity is worth it.

---

## 6. Server

### 6.1 Rooms

- `POST /api/rooms` creates a room with a short join code (e.g. `K7QX`) and makes the caller host. The host shares `https://<site>/r/K7QX` in Discord.
- Lifecycle: `lobby → playing → finished`. A finished room can start a rematch with the same seats.
- Seats are bound to Discord user ids, not connections.
- **Host leaves:** host passes to the next connected player.
- **Room cleanup:** discarded after 30 minutes with no connected players.

### 6.2 Connections and rejoin

- The WebSocket upgrade request carries the session cookie, and the server resolves it to a Discord user id.
- When a connection drops, the seat is marked `disconnected`; the game does **not** pause. If it is their turn, the turn timer (if enabled) handles it.
- Reconnecting with the same account re-binds the seat and immediately receives the current `game.view`.
- A second tab from the same account replaces the first connection.
- The client wraps `WebSocket` in a small reconnect helper with backoff.

### 6.3 Turn timer

- Configured per room (`turnSeconds`, or off).
- The server sets a deadline whenever the phase changes, includes it in `game.view` so clients can show a countdown, and on expiry applies the engine's `timeout` action (§34.1.12).
- Implementation is host-specific: `setTimeout` on Node, the alarm API on Cloudflare Durable Objects.

### 6.4 Authentication (Discord OAuth2)

```text
GET /auth/login     → redirect to discord.com/oauth2/authorize
                      (client_id, redirect_uri, scope=identify, state=<random, also set as cookie>)
GET /auth/callback  → check state, exchange code at /api/oauth2/token,
                      GET /api/users/@me, upsert user, set session cookie, redirect back
POST /auth/logout   → clear cookie
```

- **Session:** an HMAC-SHA256-signed cookie containing base64url JSON `{ sub, exp }`, verified with `crypto.subtle.verify`. It is `HttpOnly; SameSite=Lax; Path=/` and `Secure` on HTTPS. It is stateless, so no session table is needed and it works on any host.
- The Discord access token is used once to fetch the profile and is not stored.
- **Identity key:** the Discord user id. Display name and avatar are refreshed on every login.
- **Secrets:** `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`.

### 6.5 Persistence

Only users and finished games are stored. An in-progress game lives in memory in its room.

```sql
users        (discord_id TEXT PK, username TEXT, display_name TEXT, avatar TEXT,
              created_at INTEGER, last_seen INTEGER)
games        (id TEXT PK, started_at INTEGER, ended_at INTEGER,
              wrong_declaration TEXT, history_limit INTEGER,
              score_a INTEGER, score_b INTEGER, result TEXT)        -- 'A' | 'B' | 'draw'
game_players (game_id TEXT, discord_id TEXT, team TEXT,
              PRIMARY KEY (game_id, discord_id))
```

Stats (games played, wins, losses, draws, win rate) are computed by query. SQLite dialect works on both hosting options (D1 or a local SQLite/Turso file).

The Node adapter enables WAL mode and applies the shared idempotent schema on open. D1 uses the `SqlDb` adapter and shared migration; the web-standard accounts entry does not import Node modules.

### 6.6 Local and production serving

- `npm run dev` starts the Node server on port `8787` and Vite on port `5173`; Vite proxies `/api`, `/auth` and `/ws` to Node, keeping the browser's `Host` header. Local dev accounts are used only when `NODE_ENV=development`.
- Dev identities are selected per tab with the home-page dev login. Requests append `devUser=<name>` only in Vite development builds.
- `GET /api/dev/rooms/:code/state` is registered only when `LITT_DEV_TOOLS=1` and `NODE_ENV=development`. It returns full engine state for E2E move selection and is absent from production.
- `npm run build` creates the web bundle. `npm start` in production requires Discord credentials and serves `packages/web/dist`, falling back to `index.html` for `/` and `/r/:code`.

### 6.7 Hardening

- Deals, first players, timeout targets and room codes use `crypto.getRandomValues` (`server/src/security.ts`), never `Math.random`, whose state can be recovered from its outputs.
- WebSocket handshakes and non-GET HTTP requests with an `Origin` header must come from `PUBLIC_BASE_URL`'s origin or the requested `Host`.
- Limits (in-memory, per process): 10 room creations per user per 10 minutes and 5,000 open rooms; 16 seats per lobby; 30 WebSocket handshakes per user per minute and 8 open sockets per user; bursts of 40 messages per socket, refilling at 10/s (exceeding it closes the socket with 1008).
- The server pings every socket every 30 seconds and terminates sockets that miss a pong.
- Every response carries `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` (room links carry the join code) and, over HTTPS, HSTS. The built SPA is served with a strict CSP (scripts from self only; Google Fonts and provider avatars allowed). Mock mode (`?mock=1`) is compiled out of production builds.
- Production requires `SESSION_SECRET` of at least 32 characters and warns when `PUBLIC_BASE_URL` is not `https://`.

---

## 7. Web client (`packages/web`)

React + Vite single-page app. The visual design (tokens, layouts, motion, phone layout) is specified in [design/README.md](design/README.md), with a playable prototype and mockups next to it.

Routes:

- `/` — log in with Discord, create a room, your stats.
- `/r/:code` — lobby (teams, config, start) and then the game table.
- In Vite development only, the home page offers a per-tab dev identity instead of requiring Discord during local play.

Table UI:

- Own hand grouped by set.
- Opponents and teammates around the table, with an "out of cards" badge.
- The 9 sets with their status, the score and the active player.
- The last 3 transfers.
- A toast for one-time events.
- Ask flow: pick a card from sets you hold (illegal cards disabled), then pick an opponent with cards.
- Declare dialog: pick a set you hold, then assign each of its 6 cards to a teammate.

The client mirrors validation only to disable illegal options; the server remains the source of truth.

---

## 8. Hosting

Still undecided (rules.md §34.5). The design keeps the choice open by:

- using **plain WebSockets** (not Socket.IO), which work on Node and on Cloudflare Workers;
- keeping room logic in a host-independent `Room` class that takes injected `send`, `setTimer` and `persist` functions;
- using SQLite-dialect SQL.

| | Cloudflare (Workers + Durable Objects + D1) | Node on a free PaaS (e.g. Render) or home PC |
|---|---|---|
| Room | one Durable Object per room | a `Map<code, Room>` in one process |
| Timer | DO alarm | `setTimeout` |
| Database | D1 | SQLite file / Turso |
| Static site | Workers static assets | served by the Node process |
| Caveat | Cloudflare-specific adapter code | free PaaS instances sleep when idle, and in-progress games are lost on restart |

The adapter is about a 100-line layer per host. The engine, protocol, `Room` class and web client are shared.

---

## 9. Testing

| Layer | Approach |
|---|---|
| Engine | Vitest unit tests with fixed deals and a seeded rng: every ask rule, success/failure turn flow, history trimming, declarations in both modes, every row of the hand-off table (§4.5), timeout, game end and draw, card conservation (always 54 cards across hands + resolved sets), and view filtering. |
| Engine (fuzz) | Random legal-action playouts asserting the invariants from rules §31 hold after every step and every game terminates. |
| Protocol | Schema tests for valid and invalid messages. |
| Room | `Room` tested with fake `send` / timers: lobby rules, rejoin, host hand-off, timer expiry. |
| End-to-end | Chromium Playwright test with six isolated browser contexts and dev identities. It plays a full game through the UI, verifies per-player hands and synchronized scores after each action, checks stats and reload/rejoin, and captures the key screens at desktop/phone sizes in both themes. |

---

## 10. Build order

1. **Engine + tests**: complete rules, views, invariants, fuzz test.
2. **Protocol** package.
3. **Room + local Node dev server** with dev-only fake login (pick a name), so a full game can be played locally in 6 tabs.
4. **Web client**: lobby and table.
5. **Discord OAuth** and stats persistence.
6. **Integration + E2E**: root dev/build/start scripts, production static serving, and the six-context Playwright game.
7. **Pick hosting**, write that adapter, deploy.

---

## 11. Assumptions to confirm

These fill gaps in rules.md and are implemented as described above unless changed:

1. When a team is asked to choose the next player, any member of that team may make the choice (§4.5).
2. After a correct declaration that empties the declarer's team, the opposing team chooses who plays next (§4.5).
3. If the timer expires during a choose phase, a random eligible player is picked.
4. Players who disconnect do not pause the game.
5. A malformed declaration is rejected rather than counted as wrong.
6. If a choose phase would have exactly one eligible player, it is skipped and that player gets the turn.
7. The turn timer resets after every accepted action, so it is a per-move timer.
8. Seat order alternates teams (A1, B1, A2, B2, …).
9. A player who disconnects in the lobby is removed. During a game, they are only marked disconnected.
10. Turn-timer expiry when no opponent has cards: pass to a random teammate with cards (other than the current player if possible).
