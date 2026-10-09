import type { ClientMessage, ServerMessage } from "@litt/protocol";

/**
 * connecting:   never been open yet (first attempt, or retrying one that failed)
 * open:         connected
 * reconnecting: was open, dropped, retrying
 * closed:       gave up for good (replaced by another tab, room refused us, or closed by us)
 */
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface StatusInfo {
  /** Failed attempts since the last successful open. */
  attempt: number;
  /** Why the connection is closed for good. */
  reason?: string;
}

export interface RoomConnectionHandlers {
  onMessage(msg: ServerMessage): void;
  onStatus(status: ConnectionStatus, info: StatusInfo): void;
}

/** What the UI talks to. Implemented by RoomSocket and by the mock server. */
export interface RoomConnection {
  /** Returns false if the message could not be sent (not connected). */
  send(msg: ClientMessage): boolean;
  close(): void;
}

export interface RoomSocketOptions {
  WebSocketImpl?: typeof WebSocket;
  pingIntervalMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

/** Server errors after which retrying can't help. */
const TERMINAL_ERRORS = new Set(["ROOM_IN_PROGRESS", "ROOM_NOT_FOUND", "KICKED"]);

/** Framework-free WebSocket wrapper: JSON in/out, exponential backoff reconnect, keep-alive pings. */
export class RoomSocket implements RoomConnection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private everOpened = false;
  private stopped = false;
  private terminalReason: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly Impl: typeof WebSocket;
  private readonly pingIntervalMs: number;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(
    private readonly url: string,
    private readonly handlers: RoomConnectionHandlers,
    options: RoomSocketOptions = {},
  ) {
    this.Impl = options.WebSocketImpl ?? WebSocket;
    this.pingIntervalMs = options.pingIntervalMs ?? 25_000;
    this.minDelayMs = options.minDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 8_000;
    this.connect();
  }

  send(msg: ClientMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== this.Impl.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close(1000);
    }
  }

  /** Delay before retry number `attempt` (1-based): 0.5s, 1s, 2s, 4s, 8s, 8s… */
  backoffDelay(attempt: number): number {
    return Math.min(this.maxDelayMs, this.minDelayMs * 2 ** Math.max(0, attempt - 1));
  }

  private connect(): void {
    this.handlers.onStatus(this.everOpened ? "reconnecting" : "connecting", { attempt: this.attempt });
    let ws: WebSocket;
    try {
      ws = new this.Impl(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.everOpened = true;
      this.handlers.onStatus("open", { attempt: 0 });
      this.pingTimer = setInterval(() => this.send({ t: "ping" }), this.pingIntervalMs);
    };
    ws.onmessage = (e: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
      if (msg.t === "error" && TERMINAL_ERRORS.has(msg.code)) this.terminalReason = msg.code;
      this.handlers.onMessage(msg);
    };
    ws.onclose = (e: CloseEvent) => {
      this.clearTimers();
      this.ws = null;
      if (this.stopped) return;
      const reason = this.terminalReason ?? (e.reason === "replaced" ? "replaced" : null);
      if (reason) {
        this.stopped = true;
        this.handlers.onStatus("closed", { attempt: this.attempt, reason });
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // A close event always follows; reconnect is handled there.
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.attempt += 1;
    this.handlers.onStatus(this.everOpened ? "reconnecting" : "connecting", { attempt: this.attempt });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.backoffDelay(this.attempt));
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }
}
