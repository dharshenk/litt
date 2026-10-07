# Task 02 — Server: rooms, HTTP app, Node adapter (`@litt/server`)

## Context

Litt is a web version of a 54-card, 9-set, two-team Literature-style card game that friends play over Discord voice. The server is **authoritative**. Clients send intents over a WebSocket, the server validates them through the rules engine, and it sends each player only their filtered `PlayerView`.

Other agents are building, **in parallel**:
- the rules engine (`@litt/engine`, Task 01);
- the web client (Task 03);
- Discord login and stats (`@litt/accounts`, Task 04).

You build against their **contract types** only; the implementations may not exist yet.

Hosting is undecided: it will be either Cloudflare (Workers + Durable Objects) or Node. So room logic must be **host-independent**, and only a thin adapter may touch Node APIs.

Read first: `tasks/README.md`, `rules.md` §34, `ARCHITECTURE.md` (§5, §6, §8, §11), and the contract files:
- `packages/engine/src/types.ts` (the `Engine` interface)
- `packages/protocol/src/index.ts`
- `packages/accounts/src/types.ts`

## You own

- `packages/server/**`
- `tasks/reports/02.md`

## Deliverables

### 1. `src/validation.ts` — zod schemas

- One `ClientMessage` discriminated-union schema matching `@litt/protocol` exactly. Card, set and team values must be validated using `isCard` and `isSetId`, imported from `@litt/engine`. Its `index.ts` already re-exports `cards.ts`.
- `RoomConfig` bounds:
  - `wrongDeclaration` is `"award"` or `"null"`;
  - `historyLimit` is an integer from 1 to 10;
  - `turnSeconds` is `null` or an integer from 15 to 600.
- `parseClientMessage(raw: string): { ok: true; msg: ClientMessage } | { ok: false; error: string }`. Rejects bad JSON, unknown `t`, extra or missing fields, and payloads over 16 KB.
- Add a compile-time check that the zod output type is assignable to `ClientMessage`, and the reverse.

### 2. `src/room.ts` — `Room` class (host-independent)

```ts
interface RoomDeps {
  code: string;
  hostId: string;
  engine: Engine;                                   // injected, never imported here
  rng: Rng;
  now(): number;                                    // epoch ms
  setTimer(ms: number, cb: () => void): () => void; // returns cancel
  send(connId: string, msg: ServerMessage): void;
  closeConnection(connId: string, reason: string): void;
  onGameFinished(record: FinishedGameRecord): void; // called exactly once per finished game
}
class Room {
  constructor(deps: RoomDeps);
  join(connId: string, user: UserProfile): void;
  leave(connId: string): void;
  handleMessage(connId: string, raw: string): void;
  snapshot(): RoomSnapshot;
  connectedCount(): number;
}
```

**Membership:**
- **Lobby:**
  - `join` adds the user with `team: null`. A rejoin by the same user just re-binds.
  - `leave` removes the player.
  - If the host leaves, host passes to the earliest-joined remaining player.
- **Playing / finished:**
  - Only users who hold a seat may join. Anyone else gets `error ROOM_IN_PROGRESS` and the connection is closed.
  - `leave` marks the seat `connected: false`. The game is **not** paused.
  - If the host disconnects, host passes to the next connected player.
- **Same user on a second connection:** the new connection replaces the old one. Close the old one with reason `"replaced"`.
- **On join**, send the joiner:
  - `room.state`;
  - `game.view` with the current deadline, if a game exists.
- Broadcast `room.state` to everyone on any membership, team, config, host or status change.

**Lobby messages** (host only, else `NOT_HOST`; lobby only, else `WRONG_STATUS`):
- `lobby.setTeam` sets a player's team (or unassigns them).
- `lobby.setConfig` replaces the config.
- `lobby.start` requires, else `CANNOT_START` with a clear message:
  - at least 6 players;
  - all players assigned to a team;
  - equal team sizes.

  It then:
  - creates the game via `engine.createGame` with seats **alternating teams**: A1, B1, A2, B2, … in join order within each team;
  - uses config `{ wrongDeclaration, historyLimit }`;
  - sets status to `playing`, sets `startedAt = now()` and `endedAt = null` in the snapshot, broadcasts state and views, and arms the timer.

**Game messages:**
- Map `game.ask` / `game.declare` / `game.choose` to engine actions, with `player` = the sender's user id.
- If the engine rejects the action, send `error` with the engine code and message **to the sender only**.
- If it accepts:
  - store the new state;
  - broadcast each returned `GameEvent` as `game.event` to all connected players;
  - send each connected player their own `game.view` via `engine.playerView`;
  - re-arm the timer.
- Game messages outside `playing` are rejected with `WRONG_STATUS`.

**Turn timer** (`config.turnSeconds`):
- When non-null, arm a timer after the game starts and after every accepted action, cancelling the previous one. It is a per-move timer.
- The deadline (`now() + turnSeconds*1000`) goes in every `game.view` as `turnDeadline`. Without a timer it is `null`.
- On expiry, apply `{ type: "timeout" }` and process the result like any accepted action.
- Disarm when the game is over.

**Game over:**
- Triggered when the engine phase becomes `over`.
- Set status to `finished` and `endedAt = now()`, and broadcast `room.state`.
- Call `onGameFinished` once with a `FinishedGameRecord`:
  - `id` is generated with `crypto.randomUUID()`;
  - include the timestamps, config, result, scores and the players with their teams.
- `room.rematch` (host only, finished only) returns the room to `lobby`, keeping teams and config. The old game state is discarded, and `startedAt` and `endedAt` are reset to `null`.
- While the room is `finished`, keep the final game state, so players who reconnect still receive the final `game.view` for the game-over screen.

**Other messages:**
- `ping` → `pong`.
- Unparseable messages → `error BAD_MESSAGE`. Never throw out of `handleMessage`.

**Security invariant:** the full `GameState` must never be sent to any client. Only `engine.playerView(state, recipientId)` output is sent, and only to that recipient.

### 3. `src/registry.ts` — `RoomRegistry`

- `create(hostId)` returns a code: 4 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, unique among live rooms. Also provide `get(code)`.
- Rooms with zero connections for 30 minutes are disposed. Use the injected `setTimer`.
- The constructor takes a factory, so each host adapter can build `Room` deps its own way.

### 4. `src/app.ts` — Hono app factory

`createApp({ accounts: Accounts, registry: RoomRegistry })` returns a Hono app with the HTTP routes listed in `packages/protocol/src/index.ts`, except the WebSocket route, which is adapter-specific:
- `/auth/*` delegates to `accounts`.
- `/api/me` returns 401 JSON when not logged in.
- `/api/rooms` (POST, auth required) returns `{ code }`.
- `/api/stats` and `/api/stats/:userId` call `accounts`.

Use only web-standard APIs here, so the app can later run on Cloudflare Workers.

### 5. `src/dev-accounts.ts` — fake `Accounts` for local development

- Implements the `Accounts` interface with no Discord and in-memory stats.
- `handleLogin` serves a tiny HTML form asking for a name. Submitting it sets cookie `litt_dev_user=<name>` and redirects to `next` or `/`.
- `getSessionUser`:
  - returns `{ id: "dev:<name>", displayName: name, avatarUrl: null }`;
  - reads the name from a `devUser` query parameter on the request URL if present, otherwise from the cookie (see "Dev identity" in `tasks/README.md`);
  - names must match `^[A-Za-z0-9_-]{1,20}$`.
- `recordGame`, `getStats` and `getLeaderboard` compute stats in memory.
- It must be impossible to enable by accident in production. Export it, but let the adapter choose it only when `DISCORD_CLIENT_ID` is unset **and** `NODE_ENV !== "production"`.

### 6. `src/node/main.ts` — Node adapter

- Serve the Hono app with `@hono/node-server` on `PORT` (default 8787).
- Handle WebSocket upgrades on `/ws/rooms/:code` with `ws`:
  - Authenticate by building a `Request` from the upgrade request (URL + cookie header) and calling `accounts.getSessionUser`. Reject unauthenticated connections with 401.
  - Reject unknown rooms with 404.
  - On success, generate a `connId`, call `room.join`, and forward messages and close events.
- `Room` deps use `setTimeout`, `Date.now`, `Math.random` and `ws.send(JSON.stringify(msg))`.
- **Accounts selection:**
  - If `DISCORD_CLIENT_ID` is set, use `createAccounts` from `@litt/accounts` with `createBetterSqliteDb` from `@litt/accounts/node`. The database file comes from `DATABASE_PATH` (default `./litt.db`).
  - Otherwise, use dev accounts.
- **Real engine:** import `{ createGame, apply, playerView }` from `@litt/engine`.
- This file is the **only** place that imports the real engine and accounts implementations. Tasks 01 and 04 are running in parallel, so **it is acceptable if `main.ts` alone does not typecheck yet**. Say so in your report. Everything else must typecheck now.

## Tests (Vitest)

- **`validation`:** valid and invalid examples of every message type, the bounds, and oversize payloads.
- **`Room`:** use a **fake `Engine`** (a small scripted stub) plus fake timers and send/close recorders. Cover:
  - lobby join, leave and rejoin; host transfer; `NOT_HOST`; `WRONG_STATUS`; every `CANNOT_START` reason;
  - start produces alternating seat order;
  - accepted actions broadcast events and send per-player views, with each player receiving only their own view;
  - rejected actions send an error to the sender only;
  - the timer is armed, re-armed and fires `timeout`, and `turnDeadline` is included;
  - game over calls `onGameFinished` exactly once and sets `endedAt`; rematch resets `startedAt`/`endedAt`; a player reconnecting after the game ends still gets the final view;
  - a second connection replaces the first; a non-member is rejected mid-game;
  - garbage input never throws.
- **Leak test:** after several actions, assert that no `send` call to player X ever contains a card the fake engine says belongs to player Y.
- **`registry`:** code format and uniqueness; disposal after 30 idle minutes, using fake timers.
- **`app`:** route tests with `app.request(...)` and a stub `Accounts`.
- **`dev-accounts`:** the `devUser` query param overrides the cookie; invalid names are rejected.

## Out of scope

Engine rules (Task 01), Discord OAuth and SQL (Task 04), UI (Task 03), the Cloudflare adapter (later), serving the built web client (Task 05).

## Done when

- `npm test -w @litt/server` passes.
- `npm run typecheck -w @litt/server` passes, except possibly `src/node/main.ts` as noted above.
- `tasks/reports/02.md` is written.
