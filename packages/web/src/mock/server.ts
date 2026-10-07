// An in-browser stand-in for the room server, speaking the real protocol.
// It replays hand-written fixtures and answers a few messages with simple scripted
// responses so the UI can be clicked through. It is not a rules engine.

import { SET_IDS, getRecentAsks, setOf, type GameEvent, type PlayerView, type ViewWithAsks } from "@litt/engine";
import type { ClientMessage, RoomSnapshot, ServerErrorCode, ServerMessage } from "@litt/protocol";
import { sortCards } from "../lib/cards.js";
import { askProblem, isMyTurn } from "../game/legal.js";
import type { RoomConnection, RoomConnectionHandlers } from "../net/RoomSocket.js";
import { startProblem } from "../room/Lobby.js";
import { P, SEATS, makeRoom, midGame, teamOf } from "./fixtures.js";

const OPEN_DELAY_MS = 120;
const DROP_MS = 2400;

class MockConnection implements RoomConnection {
  private open = false;
  private closed = false;

  constructor(
    private readonly server: MockServer,
    readonly code: string,
    private readonly handlers: RoomConnectionHandlers,
  ) {
    handlers.onStatus("connecting", { attempt: 0 });
    setTimeout(() => this.connect(), OPEN_DELAY_MS);
  }

  private connect(): void {
    if (this.closed) return;
    this.open = true;
    this.handlers.onStatus("open", { attempt: 0 });
    this.server.greet(this);
  }

  deliver(msg: ServerMessage): void {
    if (this.open && !this.closed) this.handlers.onMessage(msg);
  }

  send(msg: ClientMessage): boolean {
    if (!this.open || this.closed) return false;
    this.server.handle(this, msg);
    return true;
  }

  close(): void {
    this.closed = true;
    this.open = false;
    this.server.disconnect(this);
  }

  drop(): void {
    if (!this.open) return;
    this.open = false;
    this.handlers.onStatus("reconnecting", { attempt: 1 });
    setTimeout(() => this.connect(), DROP_MS);
  }
}

export class MockServer {
  loggedIn = true;
  private room: RoomSnapshot | null = null;
  private view: PlayerView | null = null;
  private deadline: number | null = null;
  private readonly conns = new Set<MockConnection>();
  private scripts: ReturnType<typeof setTimeout>[] = [];
  private clock: ReturnType<typeof setTimeout> | null = null;
  private askHits = false;

  connect(code: string, handlers: RoomConnectionHandlers): RoomConnection {
    const c = new MockConnection(this, code, handlers);
    this.conns.add(c);
    return c;
  }

  disconnect(c: MockConnection): void {
    this.conns.delete(c);
  }

  hasRoom(): boolean {
    return this.room !== null;
  }

  /** Replace the whole world and push it to connected clients. */
  load(room: RoomSnapshot, view: PlayerView | null = null, deadline: number | null = null): void {
    this.scripts.forEach(clearTimeout);
    this.scripts = [];
    this.room = room;
    this.view = view;
    this.deadline = deadline ?? this.nextDeadline();
    this.armClock();
    this.broadcastRoom();
    this.broadcastView();
  }

  /** Run `fn` after `ms`, cancelled by the next load(). */
  later(ms: number, fn: () => void): void {
    this.scripts.push(setTimeout(fn, ms));
  }

  /** Events first, then the new view: the same order as the real server. */
  apply(events: GameEvent[], view: PlayerView, room?: RoomSnapshot): void {
    events.forEach((event) => this.broadcast({ t: "game.event", event }));
    const recentAsks = [...getRecentAsks(this.view ?? view)];
    for (const event of events) {
      if (event.type !== "askSucceeded" && event.type !== "askFailed") continue;
      recentAsks.push({
        seq: (recentAsks.at(-1)?.seq ?? 0) + 1,
        asker: event.asker,
        target: event.target,
        card: event.card,
        ok: event.type === "askSucceeded",
      });
    }
    const next: ViewWithAsks = { ...view, recentAsks: recentAsks.slice(-view.config.historyLimit) };
    this.view = next;
    this.deadline = view.phase.kind === "over" ? null : this.nextDeadline();
    this.armClock();
    if (room) {
      this.room = room;
      this.broadcastRoom();
    }
    this.broadcastView();
  }

  current(): { room: RoomSnapshot | null; view: PlayerView | null } {
    return { room: this.room, view: this.view };
  }

  dropConnections(): void {
    this.conns.forEach((c) => c.drop());
  }

  greet(c: MockConnection): void {
    if (!this.room) this.load(makeRoom({ status: "lobby", hostId: P.maya, teams: {} }));
    if (this.room && this.room.code !== c.code && c.code) this.room = { ...this.room, code: c.code };
    c.deliver({ t: "room.state", room: this.room! });
    if (this.view) c.deliver({ t: "game.view", view: this.view, turnDeadline: this.deadline });
  }

  handle(c: MockConnection, msg: ClientMessage): void {
    const room = this.room;
    const view = this.view;
    const isHost = room?.hostId === P.me;
    const error = (code: ServerErrorCode, message: string) => c.deliver({ t: "error", code, message });

    switch (msg.t) {
      case "ping":
        c.deliver({ t: "pong" });
        return;

      case "lobby.setTeam":
      case "lobby.setConfig":
      case "lobby.start":
        if (!room || room.status !== "lobby") return error("WRONG_STATUS", "The game has already started.");
        if (!isHost) return error("NOT_HOST", "Only the host can do that.");
        if (msg.t === "lobby.setTeam") {
          this.room = {
            ...room,
            players: room.players.map((p) => (p.id === msg.playerId ? { ...p, team: msg.team } : p)),
          };
          this.broadcastRoom();
        } else if (msg.t === "lobby.setConfig") {
          this.room = { ...room, config: msg.config };
          this.broadcastRoom();
        } else {
          const problem = startProblem(room.players);
          if (problem) return error("CANNOT_START", problem);
          // Fixture seats are fixed, so the mock game always uses the standard teams.
          this.load(
            { ...makeRoom({ status: "playing", config: room.config }), startedAt: Date.now() },
            midGame({ kind: "turn", player: P.me }, { resolved: [], transfers: [], transferCount: 0, config: room.config }),
          );
        }
        return;

      case "room.rematch":
        if (!room || room.status !== "finished") return error("WRONG_STATUS", "The game isn’t over yet.");
        if (!isHost) return error("NOT_HOST", "Only the host can start a rematch.");
        this.load({ ...room, status: "lobby", startedAt: null, endedAt: null });
        return;

      case "game.ask": {
        if (!view || room?.status !== "playing") return error("WRONG_STATUS", "No game in progress.");
        const problem = askProblem(view, msg.target, msg.card);
        if (problem) return error("NOT_YOUR_TURN", problem);
        this.askHits = !this.askHits;
        if (this.askHits) {
          const transferCount = view.transferCount + 1;
          this.apply([{ type: "askSucceeded", asker: P.me, target: msg.target, card: msg.card }], {
            ...view,
            hand: sortCards([...view.hand, msg.card]),
            transferCount,
            recentTransfers: [
              ...view.recentTransfers,
              { seq: transferCount, from: msg.target, to: P.me, card: msg.card },
            ].slice(-view.config.historyLimit),
          });
        } else {
          this.apply(
            [
              { type: "askFailed", asker: P.me, target: msg.target, card: msg.card },
              { type: "turnChanged", player: msg.target },
            ],
            { ...view, phase: { kind: "turn", player: msg.target } },
          );
        }
        return;
      }

      case "game.declare": {
        if (!view || room?.status !== "playing") return error("WRONG_STATUS", "No game in progress.");
        if (!isMyTurn(view)) return error("NOT_YOUR_TURN", "It’s not your turn.");
        // Mock declarations are always correct.
        const team = view.myTeam;
        const outcome = team === "A" ? "WON_A" : "WON_B";
        const hand = view.hand.filter((card) => setOf(card) !== msg.set);
        const sets = { ...view.sets, [msg.set]: outcome };
        const scores = { ...view.scores, [team]: view.scores[team] + 1 };
        const resolutions = [...view.resolutions, { set: msg.set, declaredBy: P.me, team, correct: true, outcome } as const];
        const players = view.players.map((p) => (p.id === P.me ? { ...p, outOfCards: hand.length === 0 } : p));
        const events: GameEvent[] = [
          { type: "declared", player: P.me, team, set: msg.set, assignment: msg.assignment, correct: true, outcome },
        ];
        const next: PlayerView = { ...view, hand, sets, scores, resolutions, players };

        if (SET_IDS.every((s) => sets[s] !== "ACTIVE")) {
          const result = scores.A > scores.B ? "A" : scores.B > scores.A ? "B" : "draw";
          events.push({ type: "gameOver", result, scores });
          this.apply(events, { ...next, phase: { kind: "over", result } }, { ...room, status: "finished", endedAt: Date.now() });
          return;
        }
        const eligible = players.filter((p) => p.team === team && !p.outOfCards).map((p) => p.id);
        if (eligible.length === 1) {
          events.push({ type: "turnChanged", player: eligible[0]! });
          this.apply(events, { ...next, phase: { kind: "turn", player: eligible[0]! } });
        } else {
          const chooser = { player: P.me };
          events.push({ type: "chooseRequired", chooser, eligible, reason: "correctDeclaration" });
          this.apply(events, { ...next, phase: { kind: "choose", chooser, eligible, reason: "correctDeclaration" } });
        }
        return;
      }

      case "game.choose": {
        if (!view || view.phase.kind !== "choose") return error("WRONG_PHASE", "There is no choice to make right now.");
        if (!view.phase.eligible.includes(msg.player)) return error("NOT_ELIGIBLE", "That player can’t take the turn.");
        this.apply([{ type: "turnChanged", player: msg.player }], { ...view, phase: { kind: "turn", player: msg.player } });
        return;
      }
    }
  }

  private nextDeadline(): number | null {
    const secs = this.room?.status === "playing" ? this.room.config.turnSeconds : null;
    return secs ? Date.now() + secs * 1000 : null;
  }

  private armClock(): void {
    if (this.clock) clearTimeout(this.clock);
    this.clock = null;
    if (this.deadline === null) return;
    this.clock = setTimeout(() => this.timeout(), Math.max(0, this.deadline - Date.now()));
  }

  /** Turn timer expiry: pass to the first opponent who still has cards. */
  private timeout(): void {
    const view = this.view;
    if (!view || view.phase.kind === "over") return;
    let next: string;
    if (view.phase.kind === "choose") next = view.phase.eligible[0]!;
    else {
      const active = view.phase.player;
      next =
        view.players.find((p) => p.team !== teamOf(active) && !p.outOfCards)?.id ??
        SEATS.find((s) => s.team === teamOf(active))!.id;
    }
    this.apply(
      [
        { type: "timedOut", phase: view.phase.kind },
        { type: "turnChanged", player: next },
      ],
      { ...view, phase: { kind: "turn", player: next } },
    );
  }

  private broadcast(msg: ServerMessage): void {
    this.conns.forEach((c) => c.deliver(msg));
  }

  private broadcastRoom(): void {
    if (this.room) this.broadcast({ t: "room.state", room: this.room });
  }

  private broadcastView(): void {
    if (this.view) this.broadcast({ t: "game.view", view: this.view, turnDeadline: this.deadline });
  }
}
