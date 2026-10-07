# Implementation tasks

The v1 build is split into five tasks. Each task is a self-contained prompt for one coding agent.

| # | Task | Package(s) owned | Depends on | Can run in parallel with |
|---|---|---|---|---|
| 01 | [Rules engine](01-engine.md) | `packages/engine` | contracts only | 02, 03, 04 |
| 02 | [Server: rooms + HTTP + Node adapter](02-server.md) | `packages/server` | contracts only | 01, 03, 04 |
| 03 | [Web client](03-web.md) | `packages/web` | contracts only | 01, 02, 04 |
| 04 | [Accounts: Discord login + stats](04-accounts.md) | `packages/accounts` | contracts only | 01, 02, 03 |
| 05 | [Integration, dev workflow, E2E](05-integration.md) | root, glue in all packages | 01–04 finished | — |

Tasks 01–04 only depend on the **contract files**, which are already written and typecheck:

- `packages/engine/src/cards.ts`: card ids, sets, lookups
- `packages/engine/src/types.ts`: game state, actions, events, errors, `PlayerView`, `Engine` interface
- `packages/protocol/src/index.ts`: HTTP API and WebSocket message types
- `packages/accounts/src/types.ts`: `Accounts` interface, `SqlDb`, `FinishedGameRecord`

To start a task, give the agent: **"Read `tasks/README.md`, then do the task in `tasks/0N-<name>.md`."**

Running agents in parallel in the same folder works because they own disjoint packages. Separate git worktrees are safer: run `git init` and commit once, then give each agent its own branch or worktree.

---

## Rules for every agent

1. **Read first:** `rules.md` (especially §34 *Finalized Decisions*), `ARCHITECTURE.md`, this README, and your task file.
2. **Stay in your package.** Only create or modify files under the paths your task owns, plus your report file.
3. **Contract files are read-only.**
   - If you believe one must change, do not edit it.
   - Instead, append an entry to `tasks/CONTRACT_CHANGES.md` under your task's heading. Say what should change and why.
   - Then work around it in your own package and mention it in your report.
4. **Code style:**
   - TypeScript `strict`, ES modules, `.js` suffixes on relative imports.
   - Vitest for tests.
   - Keep comments sparse and useful.
   - No `any` in exported APIs.
5. **Dependencies:**
   - The dependencies in each `package.json` are already installed.
   - Avoid adding new ones. If you must, use `npm install <pkg> -w @litt/<package>` and list it in your report.
   - Never run `npm audit fix --force`.
6. **Done means:**
   - `npm run typecheck -w @litt/<package>` and `npm test -w @litt/<package>` both pass.
   - Exception: a file that is explicitly allowed to wait on another task.
7. **Report:** when finished, write `tasks/reports/0N.md` containing:
   - what you built;
   - how to run it;
   - test results (paste the summary line);
   - deviations from the spec;
   - assumptions you made;
   - open questions.

## Shared conventions

- **Player id** = Discord user id (a string). It is the same id used in engine `PlayerSeat.id`.
- **Server port** in development: `8787`. The Vite dev server proxies `/api`, `/auth` and `/ws` to it.
- **Dev identity (no Discord needed locally):**
  - When the server runs without Discord credentials, it uses a fake "dev accounts" implementation.
  - For local multi-tab play-testing, the identity can come from a `devUser=<name>` query parameter on any `/api/*` or `/ws/*` request. It takes precedence over the cookie.
  - The web client, in dev builds only, keeps a per-tab dev name in `sessionStorage` (`litt_dev_user`) and appends `devUser` to those requests.
  - The dev user's id is `dev:<name>`.
- **Assumptions already decided** (see `ARCHITECTURE.md` §11):
  - **Team chooses** means any member of that team may choose.
  - **Single eligible player:** if a choose phase would have exactly one eligible player, the engine skips it and gives that player the turn.
  - **Timer resets** after every accepted action. It is a per-move timer.
  - **Seat order** alternates teams: A1, B1, A2, B2, …
  - **Lobby disconnect** removes the player. During a game, the player is only marked disconnected.
