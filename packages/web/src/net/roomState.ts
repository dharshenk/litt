import type { GameEvent, Phase, PlayerView } from "@litt/engine";
import type { RoomSnapshot, ServerErrorCode, ServerMessage } from "@litt/protocol";
import type { ConnectionStatus } from "./RoomSocket.js";

export interface QueuedEvent {
  id: number;
  event: GameEvent;
  /**
   * The phase when the event arrived. The server sends events before the new views,
   * so this is the phase the event happened in (e.g. who timed out).
   */
  phaseBefore: Phase | null;
}

export interface RoomClientState {
  connection: ConnectionStatus;
  /** Failed attempts since the last successful open. */
  attempt: number;
  everConnected: boolean;
  closedReason: string | null;
  room: RoomSnapshot | null;
  view: PlayerView | null;
  turnDeadline: number | null;
  /** Events not yet turned into spotlights/toasts. */
  events: QueuedEvent[];
  lastError: { id: number; code: ServerErrorCode; message: string } | null;
  seq: number;
}

export type RoomClientAction =
  | { type: "message"; msg: ServerMessage }
  | { type: "status"; status: ConnectionStatus; attempt: number; reason?: string }
  | { type: "eventsHandled"; upTo: number }
  | { type: "reset" };

export const initialRoomState: RoomClientState = {
  connection: "connecting",
  attempt: 0,
  everConnected: false,
  closedReason: null,
  room: null,
  view: null,
  turnDeadline: null,
  events: [],
  lastError: null,
  seq: 0,
};

const MAX_QUEUED_EVENTS = 50;

export function roomReducer(state: RoomClientState, action: RoomClientAction): RoomClientState {
  switch (action.type) {
    case "reset":
      // Keep seq increasing so event/error ids stay unique across connections.
      return { ...initialRoomState, seq: state.seq };

    case "status":
      return {
        ...state,
        connection: action.status,
        attempt: action.attempt,
        everConnected: state.everConnected || action.status === "open",
        closedReason: action.status === "closed" ? (action.reason ?? null) : null,
      };

    case "eventsHandled":
      return { ...state, events: state.events.filter((e) => e.id > action.upTo) };

    case "message": {
      const { msg } = action;
      switch (msg.t) {
        case "room.state":
          // A room back in the lobby (rematch) has no game; drop the old view.
          return msg.room.status === "lobby"
            ? { ...state, room: msg.room, view: null, turnDeadline: null }
            : { ...state, room: msg.room };
        case "game.view":
          return { ...state, view: msg.view, turnDeadline: msg.turnDeadline };
        case "game.event": {
          const id = state.seq + 1;
          const queued: QueuedEvent = { id, event: msg.event, phaseBefore: state.view?.phase ?? null };
          return { ...state, seq: id, events: [...state.events, queued].slice(-MAX_QUEUED_EVENTS) };
        }
        case "error": {
          const id = state.seq + 1;
          return { ...state, seq: id, lastError: { id, code: msg.code, message: msg.message } };
        }
        case "pong":
          return state;
        default:
          return state;
      }
    }
  }
}
