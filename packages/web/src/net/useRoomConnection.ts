import { useCallback, useEffect, useReducer, useRef, type Dispatch } from "react";
import type { ClientMessage } from "@litt/protocol";
import { wsUrl } from "../lib/api.js";
import { RoomSocket, type RoomConnection, type RoomConnectionHandlers } from "./RoomSocket.js";
import { initialRoomState, roomReducer, type RoomClientAction, type RoomClientState } from "./roomState.js";

export type ConnectionFactory = (code: string, handlers: RoomConnectionHandlers) => RoomConnection;

let factory: ConnectionFactory = (code, handlers) =>
  new RoomSocket(wsUrl(`/ws/rooms/${encodeURIComponent(code)}`), handlers);

/** Mock mode swaps in an in-browser fake server. */
export function setConnectionFactory(next: ConnectionFactory): void {
  factory = next;
}

export interface RoomConnectionApi {
  state: RoomClientState;
  dispatch: Dispatch<RoomClientAction>;
  send(msg: ClientMessage): boolean;
}

/** `nonce` forces a fresh connection (e.g. "Use this tab" after being replaced). */
export function useRoomConnection(code: string, enabled: boolean, nonce = 0): RoomConnectionApi {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const conn = useRef<RoomConnection | null>(null);

  useEffect(() => {
    if (!enabled) return;
    dispatch({ type: "reset" });
    const c = factory(code, {
      onMessage: (msg) => dispatch({ type: "message", msg }),
      onStatus: (status, info) => dispatch({ type: "status", status, attempt: info.attempt, reason: info.reason }),
    });
    conn.current = c;
    return () => {
      c.close();
      if (conn.current === c) conn.current = null;
    };
  }, [code, enabled, nonce]);

  const send = useCallback((msg: ClientMessage) => conn.current?.send(msg) ?? false, []);
  return { state, dispatch, send };
}
