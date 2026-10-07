# Task 01 — Rules engine (`@litt/engine`)

## Context

Litt is a web version of a 54-card, 9-set, two-team Literature-style card game that friends play together over Discord voice. The game server is authoritative. It runs every action through this engine and sends each player a filtered view.

You are building the **pure rules engine**: no I/O, no timers, no networking, no framework. Several other agents are building the server, web client and accounts packages **in parallel**, against the same contract types, so the contract must be implemented exactly.

Read first: `tasks/README.md`, `rules.md` (all of it; §34 overrides earlier sections), `ARCHITECTURE.md` §4 and §11.

## You own

- `packages/engine/**`, **except** the contract files `src/cards.ts` and `src/types.ts`, which are read-only.
  - You may add new helper exports in new files.
  - If a contract change is truly needed, follow the README process.
- `tasks/reports/01.md`

## Deliverables

1. **`src/game.ts`** exports:
   - `createGame(options: CreateGameOptions): CreateGameResult`
   - `apply(state: GameState, action: Action, rng?: Rng): ApplyResult`
2. **`src/view.ts`** exports `playerView(state: GameState, playerId: string): PlayerView`.
3. **`src/index.ts`** additionally exports the above. Remove the TODO. An object satisfying the `Engine` interface must be constructible as `{ createGame, apply, playerView }`.
4. **`src/rng.ts`** exports `seededRng(seed: number): Rng`, a small deterministic PRNG such as mulberry32. It is used by tests and by the server's E2E dev mode.
5. Tests under `packages/engine/test/`.

## Behaviour spec

### `createGame`

Reject with `INVALID_SETUP` when any of these hold:
- fewer than 6 players;
- an odd number of players;
- unequal teams;
- duplicate player ids;
- `historyLimit` is not an integer ≥ 1;
- `wrongDeclaration` is not `"award"` or `"null"`;
- `firstPlayer` is unknown.

With a `deal` given, also reject unless:
- it has exactly one entry per player;
- it contains all 54 cards exactly once.

**Default deal:**
- Shuffle `ALL_CARDS` with Fisher–Yates using `rng`, which defaults to `Math.random`.
- Deal round-robin starting from seat 0, so the first `54 % n` seats get one extra card.

**Hands** are always stored sorted in canonical `ALL_CARDS` order. Keep this true after every transfer.

**Initial state:**
- All sets are `ACTIVE`, scores are 0, and history and `resolutions` are empty.
- `transferCount` is 0.
- `phase = { kind: "turn", player: firstPlayer ?? random player via rng }`.

Do not reorder `players`; the caller decides seat order.

### `apply` — general

- **Pure.** Never mutate the input. Clone, using `structuredClone`, then modify.
- Any rejection returns `{ ok: false, error: { code, message } }`. The message should be human-readable and suitable to show to a player.
- If the phase is `over`, every action returns `GAME_OVER`.

### `ask { player, target, card }`

Check these in order, so error codes are deterministic:

| # | Check | Error code |
|---|---|---|
| 1 | phase is `turn` | `WRONG_PHASE` |
| 2 | `player` is a known player | `UNKNOWN_PLAYER` |
| 3 | `player` is the active player | `NOT_YOUR_TURN` |
| 4 | `target` is a known player | `UNKNOWN_PLAYER` |
| 5 | `card` is a valid card | `UNKNOWN_CARD` |
| 6 | target is on the other team | `TARGET_NOT_OPPONENT` |
| 7 | target holds at least one card | `TARGET_HAS_NO_CARDS` |
| 8 | the card's set is `ACTIVE` | `SET_NOT_ACTIVE` |
| 9 | asker does not hold the card | `ALREADY_HOLD_CARD` |
| 10 | asker holds another card of that set | `NO_BASE_CARD` |

**If the target has the card:**
- Move it to the asker, keeping hands sorted.
- Increment `transferCount` and push `{ seq: transferCount, from: target, to: asker, card }` to `history`.
- Trim `history` to the last `config.historyLimit` entries.
- The phase is unchanged.
- Events: `askSucceeded`.

**If the target doesn't have the card:**
- The phase becomes `{ kind: "turn", player: target }`.
- Events: `askFailed`, then `turnChanged`.

### `declare { player, set, assignment }`

**Checks, in order:**
1. Phase is `turn`.
2. `player` is known and active.
3. `set` is a valid id (`UNKNOWN_SET`) and `ACTIVE` (`SET_NOT_ACTIVE`).
4. `player` holds at least one card of the set (`NO_BASE_CARD`, per §34.1.3).
5. The assignment has keys for **exactly** the set's 6 cards, and every value is a player on the declarer's team. Otherwise `INVALID_ASSIGNMENT`.

**Scoring:**
- The declaration is **correct** iff every assigned player currently holds the assigned card.
- Outcome:

| Result | Mode | Set status | Score |
|---|---|---|---|
| Correct | any | `WON_<declarerTeam>` | +1 to the declarer's team |
| Wrong | `"award"` | `WON_<otherTeam>` | +1 to the other team |
| Wrong | `"null"` | `NULL` | no change |

- Remove all 6 cards of the set from whichever hands hold them, on both teams.
- History is **not** changed; declarations are not transfers.
- Append `{ set, declaredBy: player, team, correct, outcome }` to `resolutions`.
- Emit `declared { player, team, set, assignment, correct, outcome }`.

**If all 9 sets are now resolved:**
- Set `phase = { kind: "over", result }`, where result is the team with the higher score or `"draw"`.
- Emit `gameOver`.

**Otherwise, hand off the turn** (ARCHITECTURE §4.5). Only players holding ≥1 card are eligible.

| Situation | Chooser | Eligible | `reason` |
|---|---|---|---|
| Correct, and the declarer's team has cards | `{ player: declarer }` | the declarer's teammates with cards, **including the declarer** | `correctDeclaration` |
| Correct, but the declarer's team is empty | `{ team: otherTeam }` | opponents with cards | `declarerTeamEmpty` |
| Wrong, and the opponents have cards | `{ team: otherTeam }` | opponents with cards | `wrongDeclaration` |
| Wrong, but the opponents are empty | `{ team: declarerTeam }` | the declarer's teammates with cards | `opponentsEmpty` |

- If `eligible.length === 1`, skip the choose phase. Set `phase = { kind: "turn", player: eligible[0] }` and emit `turnChanged`.
- Otherwise set the choose phase and emit `chooseRequired`.
- `eligible` is listed in seat order.

### `choose { player, choice }`

- Phase must be `choose`, else `WRONG_PHASE`.
- `player` must be known (`UNKNOWN_PLAYER`) and must be the chooser (`NOT_CHOOSER`):
  - for `{ player }` choosers, the same id;
  - for `{ team }` choosers, any member of that team.
- `choice` must be in `eligible`, else `NOT_ELIGIBLE`.
- Result: `phase = { kind: "turn", player: choice }`; emit `turnChanged`.

### `timeout`

**In a `turn` phase** (§34.1.12): pick a random opponent of the active player who holds cards, using `rng`.
- If no opponent has cards, pick a random teammate with cards other than the active player.
- If there is none, the active player keeps the turn.
- Emit `timedOut { phase: "turn" }`, then `turnChanged`. Emit `turnChanged` even if the player is unchanged.

**In a `choose` phase:** pick a random eligible player. Emit `timedOut { phase: "choose" }`, then `turnChanged`.

### `playerView(state, playerId)`

Returns the `PlayerView` contract:
- the player's own sorted hand;
- `players` in seat order with `outOfCards`;
- sets, scores, phase and config;
- `recentTransfers` (a copy of `history`);
- `transferCount` and `resolutions` (both public information, used by the game-over screen).

**It must not leak anything else:** no other hands and no hand sizes. Return fresh objects so callers can't mutate state through the view. For an unknown `playerId`, throw an `Error`; the server never calls it that way.

## Tests (Vitest)

Use fixed `deal`s, `firstPlayer` and `seededRng` so tests are deterministic. Build small helpers, e.g. `makeGame({ hands })` for a 6-player game where the hands not given are filled from the remaining cards.

**Must cover:**
- **Setup:**
  - every `INVALID_SETUP` case;
  - deal sizes for 6, 8, 10 and 12 players (8 players → six with 7 cards, two with 6);
  - shuffling is deterministic under a seed;
  - all 54 cards are dealt exactly once.
- **Ask:** every error code in the documented order; success keeps the turn; failure passes to the target; history keeps only the last N with increasing `seq`; hands stay sorted.
- **Declare:**
  - correct, and wrong in both modes;
  - scores;
  - cards removed from both teams' hands;
  - `NO_BASE_CARD` for declare;
  - `INVALID_ASSIGNMENT` variants: missing card, extra card, opponent assigned, unknown player;
  - `resolutions` records each declaration in order.
- **Hand-off:** each of the 4 table rows, the single-eligible auto-skip, `NOT_CHOOSER`, `NOT_ELIGIBLE`, and a team chooser accepting any teammate.
- **Timeout:** both phases, including the fallbacks when opponents are empty.
- **Game over:** win A, win B, and a draw in null mode; actions after the game ends return `GAME_OVER`.
- **Purity:** the input state is deep-equal before and after `apply`, for both accepted and rejected actions.
- **`playerView`:** contains the own hand only. Serialize it to JSON and assert no card from another player's hand appears.
- **Fuzz test:** at least 200 seeded random games with 6–12 players. Each game uses a random legal-move policy:
  - Usually ask a legal card. Sometimes declare a set the actor holds, with either a correct assignment (computed from state) or a random one.
  - Make a valid choice in choose phases, and occasionally time out.
  - After **every** step, assert these invariants:
    - total cards in hands = 6 × the number of active sets;
    - no card appears twice;
    - no card of a resolved set is in any hand;
    - every card of an active set is in some hand;
    - each team's score = its number of `WON_<team>` sets;
    - `resolutions` has exactly one entry per non-active set, matching its status;
    - `history.length ≤ historyLimit`;
    - the active player (turn phase) has ≥1 card;
    - every eligible player has ≥1 card;
    - the active player always has at least one legal action.
  - Every game must reach `over` within 5,000 steps.

## Out of scope

Networking, timers (the server calls `timeout`), persistence, UI, Discord.

## Done when

- `npm run typecheck -w @litt/engine` and `npm test -w @litt/engine` pass.
- `tasks/reports/01.md` is written, including any rule ambiguity you found and how you resolved it.
