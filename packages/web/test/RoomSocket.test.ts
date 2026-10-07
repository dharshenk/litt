import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@litt/protocol";
import { RoomSocket, type ConnectionStatus } from "../src/net/RoomSocket.js";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static failConstruct = 0;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    if (FakeWebSocket.failConstruct > 0) {
      FakeWebSocket.failConstruct--;
      throw new Error("blocked");
    }
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Test controls
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent);
  }
  drop(reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ reason } as CloseEvent);
  }
}

function setup() {
  const statuses: [ConnectionStatus, number, string | undefined][] = [];
  const messages: ServerMessage[] = [];
  const socket = new RoomSocket(
    "ws://test/ws/rooms/K7QX",
    { onMessage: (m) => messages.push(m), onStatus: (s, info) => statuses.push([s, info.attempt, info.reason]) },
    { WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket },
  );
  const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  return { socket, statuses, messages, latest };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakeWebSocket.failConstruct = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RoomSocket: connecting and messages", () => {
  it("opens a socket to the given url and reports connecting then open", () => {
    const { statuses, latest } = setup();
    expect(latest().url).toBe("ws://test/ws/rooms/K7QX");
    expect(statuses).toEqual([["connecting", 0, undefined]]);
    latest().open();
    expect(statuses[statuses.length - 1]).toEqual(["open", 0, undefined]);
  });

  it("JSON-encodes outgoing messages and reports whether they were sent", () => {
    const { socket, latest } = setup();
    expect(socket.send({ t: "lobby.start" })).toBe(false); // not open yet
    latest().open();
    expect(socket.send({ t: "game.ask", target: "bob", card: "5H" })).toBe(true);
    expect(latest().sent.map((s) => JSON.parse(s))).toEqual([{ t: "game.ask", target: "bob", card: "5H" }]);
  });

  it("decodes incoming messages", () => {
    const { messages, latest } = setup();
    latest().open();
    latest().message({ t: "pong" });
    latest().message({ t: "error", code: "NOT_YOUR_TURN", message: "no" });
    expect(messages).toEqual([
      { t: "pong" },
      { t: "error", code: "NOT_YOUR_TURN", message: "no" },
    ]);
  });

  it.each([["not json"], ["null"], ["42"], ['{"no":"type"}']])("ignores the malformed message %s", (raw) => {
    const { messages, latest } = setup();
    latest().open();
    latest().message(raw);
    expect(messages).toEqual([]);
  });
});

describe("RoomSocket: keep-alive ping", () => {
  it("pings every 25 seconds while open", () => {
    const { latest } = setup();
    const ws = latest();
    ws.open();
    vi.advanceTimersByTime(24_999);
    expect(ws.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ws.sent).toEqual([JSON.stringify({ t: "ping" })]);
    vi.advanceTimersByTime(50_000);
    expect(ws.sent).toHaveLength(3);
  });

  it("does not ping before the socket opens", () => {
    const { latest } = setup();
    vi.advanceTimersByTime(60_000);
    expect(latest().sent).toEqual([]);
  });

  it("stops pinging a dropped socket", () => {
    const { latest } = setup();
    const ws = latest();
    ws.open();
    ws.drop();
    vi.advanceTimersByTime(100_000);
    expect(ws.sent).toEqual([]);
  });
});

describe("RoomSocket: reconnect with exponential backoff", () => {
  it("computes 0.5s, 1s, 2s, 4s, 8s, then stays at 8s", () => {
    const { socket } = setup();
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => socket.backoffDelay(n))).toEqual([
      500, 1000, 2000, 4000, 8000, 8000, 8000, 8000,
    ]);
  });

  it("retries after each drop with growing delays", () => {
    const { latest } = setup();
    const expectRetryAfter = (ms: number) => {
      const count = FakeWebSocket.instances.length;
      vi.advanceTimersByTime(ms - 1);
      expect(FakeWebSocket.instances).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(count + 1);
    };
    for (const delay of [500, 1000, 2000, 4000, 8000, 8000]) {
      latest().drop();
      expectRetryAfter(delay);
    }
  });

  it("reports connecting while the first attempts fail, with the attempt count", () => {
    const { statuses, latest } = setup();
    latest().drop();
    vi.advanceTimersByTime(500);
    latest().drop();
    expect(statuses.map(([s, a]) => [s, a])).toEqual([
      ["connecting", 0],
      ["connecting", 1], // scheduled retry
      ["connecting", 1], // retry started
      ["connecting", 2],
    ]);
  });

  it("reports reconnecting once it has been open and drops", () => {
    const { statuses, latest } = setup();
    latest().open();
    latest().drop();
    expect(statuses[statuses.length - 1]).toEqual(["reconnecting", 1, undefined]);
    vi.advanceTimersByTime(500);
    latest().open();
    expect(statuses[statuses.length - 1]).toEqual(["open", 0, undefined]);
  });

  it("resets the backoff after a successful open", () => {
    const { latest } = setup();
    latest().drop();
    vi.advanceTimersByTime(500);
    latest().drop();
    vi.advanceTimersByTime(1000);
    latest().open();
    latest().drop();
    const count = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(count + 1);
  });

  it("keeps retrying if the constructor throws", () => {
    FakeWebSocket.failConstruct = 2;
    setup();
    expect(FakeWebSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(500); // attempt 1 fails again
    expect(FakeWebSocket.instances).toHaveLength(0);
    vi.advanceTimersByTime(1000); // attempt 2 succeeds
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe("RoomSocket: closing for good", () => {
  it("close() closes the socket, stops retries and refuses sends", () => {
    const { socket, statuses, latest } = setup();
    const ws = latest();
    ws.open();
    socket.close();
    expect(ws.closedWith).toBe(1000);
    expect(socket.send({ t: "ping" })).toBe(false);
    vi.advanceTimersByTime(100_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(statuses.map(([s]) => s)).not.toContain("closed");
  });

  it("close() cancels a pending retry", () => {
    const { socket, latest } = setup();
    latest().drop();
    socket.close();
    vi.advanceTimersByTime(100_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it.each(["ROOM_IN_PROGRESS", "ROOM_NOT_FOUND"] as const)("stops retrying after %s and reports why", (code) => {
    const { statuses, latest } = setup();
    latest().open();
    latest().message({ t: "error", code, message: "nope" });
    latest().drop();
    expect(statuses[statuses.length - 1]).toEqual(["closed", 0, code]);
    vi.advanceTimersByTime(100_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("stops retrying when replaced by another tab", () => {
    const { statuses, latest } = setup();
    latest().open();
    latest().drop("replaced");
    expect(statuses[statuses.length - 1]).toEqual(["closed", 0, "replaced"]);
    vi.advanceTimersByTime(100_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("keeps retrying after an ordinary error such as NOT_YOUR_TURN", () => {
    const { latest } = setup();
    latest().open();
    latest().message({ t: "error", code: "NOT_YOUR_TURN", message: "no" });
    latest().drop();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
