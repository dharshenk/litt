# Task 04 — Accounts: Discord login, sessions, stats (`@litt/accounts`)

## Context

Litt is a web card game friends play over Discord. Login is **Discord OAuth2 only**, using the `identify` scope. Players are keyed by their **Discord user id**. The app stores users and finished games, and shows per-player win/loss stats.

Hosting is undecided: Cloudflare Workers + D1, or Node + SQLite. So everything here must use **web-standard APIs only**: `Request`, `Response`, `fetch`, `crypto.subtle`, `URL`, `TextEncoder`. Database access goes through the `SqlDb` interface, in the SQLite dialect.

Other agents are building the engine, server and web client **in parallel**. The server will call your `Accounts` implementation.

Read first: `tasks/README.md`, `ARCHITECTURE.md` §6.4–6.5, and the contracts:
- `packages/accounts/src/types.ts`, which is **your public interface**
- `packages/protocol/src/index.ts` (`UserProfile`, `PlayerStats` and the HTTP routes)

## You own

- `packages/accounts/**`, except the contract file `src/types.ts`, which is read-only.
- `tasks/reports/04.md`

## Deliverables

### 1. `src/schema.ts`

- Export `SCHEMA_SQL`, an idempotent SQL string using `CREATE TABLE IF NOT EXISTS`.
- Export `migrate(db: SqlDb): Promise<void>`.

Tables, as in ARCHITECTURE §6.5:
- `users`
- `games`
- `game_players`, with an index on `discord_id`

### 2. `src/accounts.ts` — `createAccounts(options: AccountsOptions): Accounts`

**`handleLogin(req)`:**
- Generate a random `state` of 32 bytes, base64url-encoded.
- Read `next` from the query, accepting only a relative path that starts with `/` and not `//`. Otherwise use `/`.
- Set cookie `litt_oauth` holding state + next:
  - attributes `HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600`;
  - add `Secure` when `publicBaseUrl` is https.
- 302 to `https://discord.com/oauth2/authorize` with:
  - `response_type=code`, `client_id`, `scope=identify`, `state`, `prompt=none`;
  - `redirect_uri=<publicBaseUrl>/auth/callback`.

**`handleCallback(req)`:**
- If Discord returned `error` (e.g. the user cancelled), 302 to `/?login=cancelled`.
- Verify that `state` matches the cookie. If not, 400.
- Exchange the code:
  - `POST https://discord.com/api/oauth2/token`, form-encoded;
  - fields `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret`.
- Fetch the profile: `GET https://discord.com/api/users/@me` with `Authorization: Bearer`.
- Build the profile:
  - `displayName = global_name ?? username`;
  - `avatarUrl = https://cdn.discordapp.com/avatars/{id}/{avatar}.png?size=128`, or `null` when there is no avatar.
- Upsert the user, refreshing name and avatar and setting `last_seen`.
- Set the session cookie, clear `litt_oauth`, and 302 to `next`.
- If Discord returns an error at any step, 502 with a plain message.
- **Never** log or store the access token, the code or the client secret.

**Session cookie `litt_session`:**
- Format: `base64url(JSON {sub: discordId, exp}) + "." + base64url(HMAC-SHA256(sessionSecret, payload))`, using `crypto.subtle`.
- Lifetime 30 days.
- Attributes `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` on https.

**`getSessionUser(req)`:**
- Parse cookies and verify the signature with `crypto.subtle.verify`, which is constant-time.
- Check `exp` against `now()`.
- Load the user from the database, so the name and avatar are current.
- Return `null` on any failure. **Never throw.**

**`handleLogout`:** expire `litt_session` and return 204.

**`recordGame(record)`:**
- Insert into `games` and `game_players`.
- Make it **idempotent** on `record.id` (`INSERT OR IGNORE`). Calling it twice must not double-count.

**`getStats(userId)`:** returns `PlayerStats`, or `null` if the user is unknown.
- `played`, `wins`, `losses`, `draws` come from the join of `game_players` and `games`.
- A draw is `result = 'draw'`.
- A win is `result = team`, and any other result is a loss.

**`getLeaderboard()`:** all users with at least 1 game played, sorted by wins desc, then win rate desc, then name.

### 3. `src/d1.ts` — `fromD1(d1): SqlDb`

- An adapter for Cloudflare D1. Define a minimal local `D1Like` interface with `prepare(sql).bind(...).run()`, `.all()` and `.first()`.
- Do not add Cloudflare dependencies.
- It is for later use; a unit test with a fake `D1Like` is enough.

### 4. `src/node.ts` — `createBetterSqliteDb(filename: string): SqlDb`

- A wrapper over `better-sqlite3`, Node only.
- Enable WAL mode and run `migrate` on open. You may expose an async `open`.
- Expose it as the subpath export `@litt/accounts/node` via `package.json` `"exports"`. Keep `"."` → `src/index.ts`.
- Move `better-sqlite3` from devDependencies to dependencies. `index.ts` must **not** import `node.ts`, so the main entry stays Workers-safe.

### 5. `src/index.ts`

Export `createAccounts`, `migrate`, `SCHEMA_SQL`, `fromD1` and the contract types. Remove the TODO.

## Tests (Vitest)

Use a real in-memory `better-sqlite3` database through your wrapper, an injected fake `fetch` that simulates Discord, and an injected `now`.

- **Login:**
  - the redirect URL has all its params;
  - the cookie attributes are correct, including `Secure` only on https;
  - `next` sanitization covers `//evil.com`, `https://evil.com`, `/r/ABCD` and a missing value.
- **Callback:**
  - the happy path creates the user, sets the session and redirects to `next`;
  - a state mismatch returns 400;
  - a missing state cookie returns 400;
  - Discord `error=access_denied` redirects;
  - a token endpoint failure returns 502;
  - a profile with no avatar gives `avatarUrl` `null`;
  - a returning user gets an updated name.
- **Session:**
  - valid;
  - tampered payload;
  - tampered signature;
  - expired (via `now`);
  - a garbage cookie returns `null` without throwing;
  - a deleted user returns `null`.
- **Logout:** clears the cookie.
- **Stats:**
  - a mix of wins, losses and draws across 3 games for 6–8 players;
  - `recordGame` is idempotent;
  - leaderboard ordering;
  - an unknown user returns `null`.
- **`fromD1`:** works with a fake `D1Like`.
- **No secrets in output:** spy on `console` during the callback and assert that neither the client secret nor the token appears.

## Out of scope

The HTTP framework and routing (the server mounts your handlers), the UI, game logic, and creating the Discord application. Do document the setup steps in your report:
1. Create an application in the Discord Developer Portal.
2. Copy the client id and secret.
3. Add the redirect URIs `http://localhost:8787/auth/callback` and the production one.

## Done when

- `npm run typecheck -w @litt/accounts` and `npm test -w @litt/accounts` pass.
- `tasks/reports/04.md` is written, including the Discord setup steps.
