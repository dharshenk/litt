import type { Card, PlayerView } from "@litt/engine";
import { sortCards } from "../lib/cards.js";
import {
  CODE,
  FINAL_DRAW,
  FINAL_LOSS,
  FINAL_WIN,
  LOBBY_READY,
  LOBBY_SETUP,
  MID_RESOLVED,
  P,
  finalView,
  makeRoom,
  midGame,
} from "./fixtures.js";
import type { MockServer } from "./server.js";

export interface ScenarioContext {
  server: MockServer;
  /** Navigate within the app; `state` presets table UI (e.g. the Declare tab). */
  go(path: string, state?: { tab?: "ask" | "declare" }): void;
}

export interface Scenario {
  group: string;
  label: string;
  run(ctx: ScenarioContext): void;
}

/** Stable id for deep links: `?mock=1&scenario=table-my-turn-ask`. */
export const scenarioId = (s: Scenario) =>
  `${s.group}-${s.label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const ROOM = `/r/${CODE}`;
const playing = (config: Parameters<typeof makeRoom>[0]["config"] = {}) => makeRoom({ status: "playing", config });
const myTurn = () => midGame({ kind: "turn", player: P.me });

function table(ctx: ScenarioContext, view: PlayerView, opts: { tab?: "ask" | "declare"; turnSeconds?: number | null; deadline?: number } = {}) {
  ctx.server.loggedIn = true;
  ctx.server.load(playing({ turnSeconds: opts.turnSeconds ?? null }), view, opts.deadline ?? null);
  ctx.go(ROOM, { tab: opts.tab });
}

function finished(ctx: ScenarioContext, view: PlayerView) {
  ctx.server.loggedIn = true;
  const endedAt = Date.now();
  ctx.server.load(
    makeRoom({ status: "finished", startedAt: endedAt - 38 * 60_000, endedAt, config: { wrongDeclaration: view.config.wrongDeclaration } }),
    view,
  );
  ctx.go(ROOM);
}

function lobby(ctx: ScenarioContext, host: string, teams: typeof LOBBY_SETUP) {
  ctx.server.loggedIn = true;
  ctx.server.load(makeRoom({ status: "lobby", hostId: host, teams, config: { turnSeconds: 60 } }));
  ctx.go(ROOM);
}

export const SCENARIOS: Scenario[] = [
  {
    group: "Home",
    label: "Logged out",
    run: (ctx) => {
      ctx.server.loggedIn = false;
      ctx.go("/");
    },
  },
  {
    group: "Home",
    label: "Logged in",
    run: (ctx) => {
      ctx.server.loggedIn = true;
      ctx.go("/");
    },
  },

  { group: "Lobby", label: "Host · setting up", run: (ctx) => lobby(ctx, P.me, LOBBY_SETUP) },
  { group: "Lobby", label: "Host · ready to start", run: (ctx) => lobby(ctx, P.me, LOBBY_READY) },
  { group: "Lobby", label: "Guest · setting up", run: (ctx) => lobby(ctx, P.maya, LOBBY_SETUP) },
  { group: "Lobby", label: "Guest · ready to start", run: (ctx) => lobby(ctx, P.maya, LOBBY_READY) },

  { group: "Table", label: "My turn · ask", run: (ctx) => table(ctx, myTurn(), { tab: "ask" }) },
  { group: "Table", label: "My turn · declare", run: (ctx) => table(ctx, myTurn(), { tab: "declare" }) },
  { group: "Table", label: "Someone else’s turn", run: (ctx) => table(ctx, midGame({ kind: "turn", player: P.bob })) },
  {
    group: "Table",
    label: "Out-of-cards players",
    run: (ctx) => table(ctx, midGame({ kind: "turn", player: P.me }, { out: [P.eve, P.frank] })),
  },
  {
    group: "Table",
    label: "Timer warning",
    run: (ctx) => table(ctx, myTurn(), { turnSeconds: 60, deadline: Date.now() + 9_500 }),
  },
  {
    group: "Table",
    label: "Choose · I pick",
    run: (ctx) =>
      table(
        ctx,
        midGame({
          kind: "choose",
          chooser: { player: P.me },
          eligible: [P.me, P.maya, P.eve],
          reason: "correctDeclaration",
        }),
      ),
  },
  {
    group: "Table",
    label: "Choose · Team B picks",
    run: (ctx) =>
      table(
        ctx,
        midGame({
          kind: "choose",
          chooser: { team: "B" },
          eligible: [P.bob, P.priya, P.frank],
          reason: "wrongDeclaration",
        }),
      ),
  },

  {
    group: "Events",
    label: "Ask spotlight · success",
    run: (ctx) => {
      const before = myTurn();
      table(ctx, before);
      ctx.server.later(900, () => {
        const card: Card = "5H";
        const seq = before.transferCount + 1;
        ctx.server.apply([{ type: "askSucceeded", asker: P.me, target: P.bob, card }], {
          ...before,
          hand: sortCards([...before.hand, card]),
          transferCount: seq,
          recentTransfers: [...before.recentTransfers, { seq, from: P.bob, to: P.me, card }].slice(-3),
        });
      });
    },
  },
  {
    group: "Events",
    label: "Ask spotlight · failed",
    run: (ctx) => {
      const before = midGame({ kind: "turn", player: P.bob });
      table(ctx, before);
      ctx.server.later(900, () => {
        ctx.server.apply(
          [
            { type: "askFailed", asker: P.bob, target: P.me, card: "2H" },
            { type: "turnChanged", player: P.me },
          ],
          { ...before, phase: { kind: "turn", player: P.me } },
        );
      });
    },
  },
  {
    group: "Events",
    label: "Declaration · correct",
    run: (ctx) => {
      const before = midGame({ kind: "turn", player: P.maya });
      table(ctx, before);
      ctx.server.later(900, () => {
        const after = midGame(
          { kind: "choose", chooser: { player: P.maya }, eligible: [P.me, P.maya, P.eve], reason: "correctDeclaration" },
          { resolved: [...MID_RESOLVED, ["LOW_C", P.maya, true, "WON_A"]] },
        );
        const assignment = { "2C": P.maya, "3C": P.eve, "4C": P.me, "5C": P.maya, "6C": P.maya, "7C": P.eve };
        ctx.server.apply(
          [
            {
              type: "declared",
              player: P.maya,
              team: "A",
              set: "LOW_C",
              assignment,
              holders: assignment,
              correct: true,
              outcome: "WON_A",
            },
            { type: "chooseRequired", chooser: { player: P.maya }, eligible: [P.me, P.maya, P.eve], reason: "correctDeclaration" },
          ],
          after,
        );
      });
    },
  },
  {
    group: "Events",
    label: "Declaration · wrong",
    run: (ctx) => {
      const before = midGame({ kind: "turn", player: P.bob });
      table(ctx, before);
      ctx.server.later(900, () => {
        const after = midGame(
          { kind: "choose", chooser: { team: "A" }, eligible: [P.me, P.maya, P.eve], reason: "wrongDeclaration" },
          { resolved: [...MID_RESOLVED, ["HIGH_C", P.bob, false, "WON_A"]] },
        );
        ctx.server.apply(
          [
            {
              type: "declared",
              player: P.bob,
              team: "B",
              set: "HIGH_C",
              assignment: { "9C": P.bob, "10C": P.priya, JC: P.bob, QC: P.frank, KC: P.priya, AC: P.bob },
              // 10C was in my hand and AC with Priya, so two of Bob's six calls were wrong.
              holders: { "9C": P.bob, "10C": P.me, JC: P.bob, QC: P.frank, KC: P.priya, AC: P.priya },
              correct: false,
              outcome: "WON_A",
            },
            { type: "chooseRequired", chooser: { team: "A" }, eligible: [P.me, P.maya, P.eve], reason: "wrongDeclaration" },
          ],
          after,
        );
      });
    },
  },
  {
    group: "Events",
    label: "Reconnecting",
    run: (ctx) => {
      if (!ctx.server.hasRoom() || !ctx.server.current().view) table(ctx, myTurn());
      else ctx.go(ROOM);
      ctx.server.later(600, () => ctx.server.dropConnections());
    },
  },

  { group: "Game over", label: "Win", run: (ctx) => finished(ctx, finalView(FINAL_WIN, "null", 47)) },
  { group: "Game over", label: "Loss", run: (ctx) => finished(ctx, finalView(FINAL_LOSS, "award", 52)) },
  { group: "Game over", label: "Draw", run: (ctx) => finished(ctx, finalView(FINAL_DRAW, "null", 39)) },
];
