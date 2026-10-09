import type { Action, Engine, GameEvent, GameState, PlayerSeat, Rng } from "@litt/engine";
import type { FinishedGameRecord } from "@litt/accounts";
import { DEFAULT_ROOM_CONFIG, type ClientMessage, type RoomConfig, type RoomPlayer, type RoomSnapshot, type RoomStatus, type ServerErrorCode, type ServerMessage, type UserProfile } from "@litt/protocol";
import { parseClientMessage } from "./validation.js";

export interface RoomDeps {
  code: string;
  hostId: string;
  engine: Engine;
  rng: Rng;
  now(): number;
  setTimer(ms: number, cb: () => void): () => void;
  send(connId: string, msg: ServerMessage): void;
  closeConnection(connId: string, reason: string): void;
  onGameFinished(record: FinishedGameRecord): void;
  onConnectionsChanged?(): void;
}

interface Seat {
  player: RoomPlayer;
  connId: string | null;
}

export class Room {
  private readonly seats = new Map<string, Seat>();
  private readonly connections = new Map<string, string>();
  private readonly kicked = new Set<string>();
  private hostId: string;
  private hostVacant = false;
  private status: RoomStatus = "lobby";
  private config: RoomConfig = { ...DEFAULT_ROOM_CONFIG };
  private game: GameState | null = null;
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private turnDeadline: number | null = null;
  private cancelTimer: (() => void) | null = null;
  private timerVersion = 0;
  private recorded = false;
  private disposed = false;

  constructor(private readonly deps: RoomDeps) {
    this.hostId = deps.hostId;
  }

  join(connId: string, user: UserProfile): void {
    if (this.disposed) {
      this.deps.closeConnection(connId, "disposed");
      return;
    }
    if (this.kicked.has(user.id)) {
      this.error(connId, "KICKED", "You were removed from this room by the host");
      this.deps.closeConnection(connId, "kicked");
      return;
    }
    let seat = this.seats.get(user.id);
    if (!seat && this.status !== "lobby") {
      this.error(connId, "ROOM_IN_PROGRESS", "Only seated players may join this game");
      this.deps.closeConnection(connId, "room in progress");
      return;
    }
    if (seat?.connId && seat.connId !== connId) {
      const oldConnection = seat.connId;
      this.connections.delete(oldConnection);
      seat.connId = null;
      this.deps.closeConnection(oldConnection, "replaced");
    }
    if (!seat) {
      seat = { player: { ...user, team: null, connected: true }, connId };
      this.seats.set(user.id, seat);
    } else {
      seat.player = { ...user, team: seat.player.team, connected: true };
      seat.connId = connId;
    }
    this.connections.set(connId, user.id);
    if (this.hostVacant) {
      this.hostId = user.id;
      this.hostVacant = false;
    }
    this.broadcastState();
    this.sendView(connId, user.id);
    this.deps.onConnectionsChanged?.();
  }

  leave(connId: string): void {
    const userId = this.connections.get(connId);
    if (userId === undefined) return;
    this.connections.delete(connId);
    const seat = this.seats.get(userId);
    if (!seat || seat.connId !== connId) return;
    seat.connId = null;
    seat.player.connected = false;
    if (this.status === "lobby") this.seats.delete(userId);
    if (this.hostId === userId) {
      const next = [...this.seats.values()].find((candidate) => candidate.player.connected);
      if (next) this.hostId = next.player.id;
      else this.hostVacant = true;
    }
    this.broadcastState();
    this.deps.onConnectionsChanged?.();
  }

  handleMessage(connId: string, raw: string): void {
    if (this.disposed || !this.connections.has(connId)) return;
    try {
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        this.error(connId, "BAD_MESSAGE", parsed.error);
        return;
      }
      this.handle(connId, this.connections.get(connId)!, parsed.msg);
    } catch {
      try {
        this.error(connId, "BAD_MESSAGE", "Unable to handle message");
      } catch {
        return;
      }
    }
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.deps.code,
      status: this.status,
      hostId: this.hostId,
      players: [...this.seats.values()].map((seat) => ({ ...seat.player })),
      config: { ...this.config },
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }

  devState(): GameState | null {
    return this.game;
  }

  connectedCount(): number {
    return this.connections.size;
  }

  dispose(): void {
    this.disposed = true;
    this.disarmTimer();
    for (const connId of this.connections.keys()) this.deps.closeConnection(connId, "disposed");
    this.connections.clear();
  }

  private handle(connId: string, userId: string, msg: ClientMessage): void {
    if (msg.t === "ping") {
      this.deps.send(connId, { t: "pong" });
      return;
    }
    if (msg.t.startsWith("lobby.") || msg.t === "room.rematch") {
      if (userId !== this.hostId) {
        this.error(connId, "NOT_HOST", "Only the host may change the room");
        return;
      }
      const requiredStatus = msg.t === "room.rematch" ? "finished" : "lobby";
      if (this.status !== requiredStatus) {
        this.error(connId, "WRONG_STATUS", `This action requires a ${requiredStatus} room`);
        return;
      }
    }
    switch (msg.t) {
      case "lobby.setTeam": {
        const seat = this.seats.get(msg.playerId);
        if (!seat) {
          this.error(connId, "UNKNOWN_PLAYER", "Player is not in this room");
          return;
        }
        seat.player.team = msg.team;
        this.broadcastState();
        return;
      }
      case "lobby.kick": {
        const seat = this.seats.get(msg.playerId);
        if (!seat) {
          this.error(connId, "UNKNOWN_PLAYER", "Player is not in this room");
          return;
        }
        if (msg.playerId === this.hostId) {
          this.error(connId, "BAD_MESSAGE", "The host cannot be kicked");
          return;
        }
        this.kicked.add(msg.playerId);
        this.seats.delete(msg.playerId);
        if (seat.connId) {
          this.connections.delete(seat.connId);
          this.error(seat.connId, "KICKED", "You were removed from the room by the host");
          this.deps.closeConnection(seat.connId, "kicked");
        }
        this.broadcastState();
        this.deps.onConnectionsChanged?.();
        return;
      }
      case "lobby.setConfig":
        this.config = { ...msg.config };
        this.broadcastState();
        return;
      case "lobby.start":
        this.start(connId);
        return;
      case "room.rematch":
        this.disarmTimer();
        this.status = "lobby";
        this.game = null;
        this.startedAt = null;
        this.endedAt = null;
        this.recorded = false;
        this.broadcastState();
        return;
      default: {
        if (this.status !== "playing" || !this.game) {
          this.error(connId, "WRONG_STATUS", "Game actions require a playing room");
          return;
        }
        const action: Action = msg.t === "game.ask"
          ? { type: "ask", player: userId, target: msg.target, card: msg.card }
          : msg.t === "game.declare"
            ? { type: "declare", player: userId, set: msg.set, assignment: msg.assignment }
            : { type: "choose", player: userId, choice: msg.player };
        const result = this.deps.engine.apply(this.game, action, this.deps.rng);
        if (!result.ok) this.error(connId, result.error.code, result.error.message);
        else this.accept(result.state, result.events);
      }
    }
  }

  private start(connId: string): void {
    const players = [...this.seats.values()].map((seat) => seat.player);
    const teamA = players.filter((player) => player.team === "A");
    const teamB = players.filter((player) => player.team === "B");
    const reason = players.length < 6 ? "At least 6 players are required"
      : players.some((player) => player.team === null) ? "All players must be assigned to a team"
        : teamA.length !== teamB.length ? "Teams must have equal numbers of players" : null;
    if (reason) {
      this.error(connId, "CANNOT_START", reason);
      return;
    }
    const seats: PlayerSeat[] = teamA.flatMap((player, index) => [
      { id: player.id, team: "A" as const },
      { id: teamB[index]!.id, team: "B" as const },
    ]);
    const result = this.deps.engine.createGame({
      players: seats,
      config: { wrongDeclaration: this.config.wrongDeclaration, historyLimit: this.config.historyLimit },
      rng: this.deps.rng,
    });
    if (!result.ok) {
      this.error(connId, result.error.code, result.error.message);
      return;
    }
    this.game = result.state;
    this.status = "playing";
    this.startedAt = this.deps.now();
    this.endedAt = null;
    this.recorded = false;
    this.armTimer();
    this.broadcastState();
    this.broadcastViews();
  }

  private accept(state: GameState, events: GameEvent[]): void {
    this.game = state;
    if (state.phase.kind === "over") {
      this.status = "finished";
      this.endedAt = this.deps.now();
    }
    this.armTimer();
    for (const event of events) this.broadcast({ t: "game.event", event });
    if (this.status === "finished") this.broadcastState();
    this.broadcastViews();
    if (state.phase.kind === "over" && !this.recorded) {
      this.recorded = true;
      this.deps.onGameFinished({
        id: crypto.randomUUID(),
        startedAt: this.startedAt!,
        endedAt: this.endedAt!,
        config: { ...state.config },
        result: state.phase.result,
        scores: { ...state.scores },
        players: state.players.map((player) => ({ ...player })),
      });
    }
  }

  private disarmTimer(): void {
    this.timerVersion += 1;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.turnDeadline = null;
  }

  private armTimer(): void {
    this.disarmTimer();
    if (this.disposed || this.status !== "playing" || this.config.turnSeconds === null) return;
    const duration = this.config.turnSeconds * 1000;
    const version = this.timerVersion;
    this.turnDeadline = this.deps.now() + duration;
    this.cancelTimer = this.deps.setTimer(duration, () => {
      if (version !== this.timerVersion || this.status !== "playing" || !this.game) return;
      const result = this.deps.engine.apply(this.game, { type: "timeout" }, this.deps.rng);
      if (result.ok) this.accept(result.state, result.events);
      else this.disarmTimer();
    });
  }

  private error(connId: string, code: ServerErrorCode, message: string): void {
    this.deps.send(connId, { t: "error", code, message });
  }

  private broadcast(msg: ServerMessage): void {
    for (const connId of this.connections.keys()) this.deps.send(connId, msg);
  }

  private broadcastState(): void {
    this.broadcast({ t: "room.state", room: this.snapshot() });
  }

  private sendView(connId: string, userId: string): void {
    if (!this.game) return;
    this.deps.send(connId, {
      t: "game.view",
      view: this.deps.engine.playerView(this.game, userId),
      turnDeadline: this.turnDeadline,
    });
  }

  private broadcastViews(): void {
    for (const [connId, userId] of this.connections) this.sendView(connId, userId);
  }
}
