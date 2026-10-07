// CONTRACT FILE — wire types shared by server and web. Types only, no runtime code.
// Do not change without agreement; see tasks/README.md ("Contract changes").

import type {
  Assignment,
  Card,
  ErrorCode,
  GameEvent,
  PlayerView,
  SetId,
  Team,
  WrongDeclarationMode,
} from "@litt/engine";

// ---------- Users & stats (HTTP) ----------

export interface UserProfile {
  /** Discord user id. */
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PlayerStats extends UserProfile {
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

/**
 * HTTP API
 *   GET  /auth/login              → 302 to Discord
 *   GET  /auth/callback           → 302 to "/" (or ?next=) with session cookie
 *   POST /auth/logout             → 204, clears cookie
 *   GET  /api/me                  → 200 UserProfile | 401
 *   POST /api/rooms               → 200 CreateRoomResponse | 401
 *   GET  /api/stats               → 200 PlayerStats[] (all users, sorted by wins desc)
 *   GET  /api/stats/:userId       → 200 PlayerStats | 404
 *   WS   /ws/rooms/:code          → WebSocket; session cookie required
 */
export interface CreateRoomResponse {
  code: string;
}

// ---------- Rooms ----------

export interface RoomConfig {
  wrongDeclaration: WrongDeclarationMode;
  historyLimit: number;
  /** Per-turn timer in seconds, or null for no timer. */
  turnSeconds: number | null;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  wrongDeclaration: "award",
  historyLimit: 3,
  turnSeconds: null,
};

export type RoomStatus = "lobby" | "playing" | "finished";

export interface RoomPlayer extends UserProfile {
  /** null while unassigned in the lobby. */
  team: Team | null;
  connected: boolean;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  hostId: string;
  players: RoomPlayer[];
  config: RoomConfig;
}

// ---------- WebSocket messages ----------

export type ClientMessage =
  | { t: "lobby.setTeam"; playerId: string; team: Team | null } // host only
  | { t: "lobby.setConfig"; config: RoomConfig } // host only, lobby only
  | { t: "lobby.start" } // host only
  | { t: "room.rematch" } // host only, finished only → back to lobby, teams kept
  | { t: "game.ask"; target: string; card: Card }
  | { t: "game.declare"; set: SetId; assignment: Assignment }
  | { t: "game.choose"; player: string }
  | { t: "ping" };

export type ServerErrorCode =
  | "BAD_MESSAGE"
  | "NOT_HOST"
  | "ROOM_NOT_FOUND"
  | "ROOM_IN_PROGRESS"
  | "WRONG_STATUS"
  | "CANNOT_START"
  /** Engine rejections are forwarded with the engine's ErrorCode. */
  | ErrorCode;

export type ServerMessage =
  /** Sent on connect and whenever room membership/teams/config/status change. */
  | { t: "room.state"; room: RoomSnapshot }
  /** Personalized; sent to each player on connect and after every game change. */
  | { t: "game.view"; view: PlayerView; turnDeadline: number | null }
  /** One-time notices; not replayed on reconnect. */
  | { t: "game.event"; event: GameEvent }
  /** Sent only to the client whose message was rejected. */
  | { t: "error"; code: ServerErrorCode; message: string }
  | { t: "pong" };
