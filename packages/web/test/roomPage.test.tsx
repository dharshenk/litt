import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import type { GameEvent } from "@litt/engine";
import type { ClientMessage, ServerMessage, UserProfile } from "@litt/protocol";
import { ToastProvider } from "../src/components/Toasts.js";
import { setApi } from "../src/lib/api.js";
import { cardLabel, setInfo } from "../src/lib/cards.js";
import type { ConnectionStatus, RoomConnection, RoomConnectionHandlers } from "../src/net/RoomSocket.js";
import { setConnectionFactory } from "../src/net/useRoomConnection.js";
import { RoomPage } from "../src/pages/RoomPage.js";
import { makeRoom, makeView } from "./fixtures.js";

const ME: UserProfile = { id: "me", displayName: "dharshen", avatarUrl: null };

class FakeConn implements RoomConnection {
  sent: ClientMessage[] = [];
  closed = false;
  accept = true;
  constructor(
    readonly code: string,
    readonly handlers: RoomConnectionHandlers,
  ) {}
  send(msg: ClientMessage) {
    if (this.accept) this.sent.push(msg);
    return this.accept;
  }
  close() {
    this.closed = true;
  }
}

let conns: FakeConn[] = [];
let unmount: () => void = () => {};

function install(me: UserProfile | null = ME) {
  conns = [];
  setApi({
    me: async () => me,
    createRoom: async () => ({ code: "ZZZZ" }),
    logout: async () => {},
    stats: async () => [],
  });
  setConnectionFactory((code, handlers) => {
    const c = new FakeConn(code, handlers);
    conns.push(c);
    return c;
  });
}

async function renderRoom(path = "/r/K7QX"): Promise<FakeConn> {
  ({ unmount } = render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<div>home page</div>} />
          <Route path="/r/:code" element={<RoomPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  ));
  await waitFor(() => expect(conns.length).toBeGreaterThan(0));
  return conns[conns.length - 1]!;
}

const deliver = (conn: FakeConn, ...msgs: ServerMessage[]) =>
  act(() => {
    for (const m of msgs) conn.handlers.onMessage(m);
  });

const status = (conn: FakeConn, s: ConnectionStatus, attempt = 0, reason?: string) =>
  act(() => conn.handlers.onStatus(s, { attempt, reason }));

const start = (conn: FakeConn, view = makeView()) => {
  status(conn, "open");
  deliver(conn, { t: "room.state", room: makeRoom({ status: "playing" }) }, { t: "game.view", view, turnDeadline: null });
};

beforeEach(() => install());

type Declared = Extract<GameEvent, { type: "declared" }>;

/** Team B declares High ♣ wrongly: 10♣ was in my hand, and A♣ was with Priya, not Bob. */
const wrongHighC: Declared = {
  type: "declared",
  player: "bob",
  team: "B",
  set: "HIGH_C",
  assignment: { "9C": "bob", "10C": "priya", JC: "bob", QC: "frank", KC: "priya", AC: "bob" },
  holders: { "9C": "bob", "10C": "me", JC: "bob", QC: "frank", KC: "priya", AC: "priya" },
  correct: false,
  outcome: "WON_A",
};

/** Team B declares High ♦ wrongly in a game that nullifies: Frank, not Bob, had Q♦. */
const wrongHighD: Declared = {
  type: "declared",
  player: "bob",
  team: "B",
  set: "HIGH_D",
  assignment: { "9D": "bob", "10D": "bob", JD: "priya", QD: "bob", KD: "frank", AD: "priya" },
  holders: { "9D": "bob", "10D": "bob", JD: "priya", QD: "frank", KD: "frank", AD: "priya" },
  correct: false,
  outcome: "NULL",
};

const dialog = () => screen.getByRole("dialog", { name: /Wrong declaration/ });

describe("RoomPage: getting in", () => {
  it("asks a logged-out visitor to log in, and does not connect", async () => {
    install(null);
    render(
      <MemoryRouter initialEntries={["/r/K7QX"]}>
        <ToastProvider>
          <Routes>
            <Route path="/r/:code" element={<RoomPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: /Log in with Discord/ });
    expect(link.getAttribute("href")).toBe("/auth/login?next=%2Fr%2FK7QX");
    expect(screen.getByText("Room · K7QX")).toBeTruthy();
    expect(conns).toHaveLength(0);
  });

  it("connects to the room code in the URL, upper-cased", async () => {
    const conn = await renderRoom("/r/k7qx");
    expect(conn.code).toBe("K7QX");
    expect(screen.getByText("Joining room K7QX…")).toBeTruthy();
  });

  it("says it can't reach the room after repeated failed attempts", async () => {
    const conn = await renderRoom();
    status(conn, "connecting", 3);
    expect(screen.getByText("Can’t reach room K7QX")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" })).toBeTruthy();
  });

  it("closes the connection when leaving the page", async () => {
    const conn = await renderRoom();
    status(conn, "open");
    expect(conn.closed).toBe(false);
    unmount();
    expect(conn.closed).toBe(true);
  });
});

describe("RoomPage: lobby and table", () => {
  it("shows the lobby for a lobby room, with host controls for the host", async () => {
    const conn = await renderRoom();
    status(conn, "open");
    deliver(conn, { t: "room.state", room: makeRoom({ status: "lobby", teams: { eve: null } }) });
    expect(screen.getByRole("heading", { name: "Table rules" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start game" })).toBeTruthy();
  });

  it("sends lobby messages over the connection", async () => {
    const conn = await renderRoom();
    status(conn, "open");
    deliver(conn, { t: "room.state", room: makeRoom({ status: "lobby" }) });
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    expect(conn.sent).toEqual([{ t: "lobby.start" }]);
  });

  it("switches to the table when the game view arrives", async () => {
    const conn = await renderRoom();
    start(conn);
    expect(screen.getByText("Your turn")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Your hand" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Table rules" })).toBeNull();
  });

  it("waits for the first view while the room is playing", async () => {
    const conn = await renderRoom();
    status(conn, "open");
    deliver(conn, { t: "room.state", room: makeRoom({ status: "playing" }) });
    expect(screen.getByText("Dealing…")).toBeTruthy();
  });

  it("goes back to the lobby on a rematch, dropping the old game", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, { t: "room.state", room: makeRoom({ status: "lobby" }) });
    expect(screen.getByRole("heading", { name: "Table rules" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Your hand" })).toBeNull();
  });

  it("sends an ask from the table", async () => {
    const conn = await renderRoom();
    start(conn);
    fireEvent.click(screen.getByRole("radio", { name: setInfo("LOW_H").name }));
    fireEvent.click(screen.getByRole("radio", { name: cardLabel("5H") }));
    fireEvent.click(screen.getByRole("radio", { name: /^Bob/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Ask Bob/ }));
    expect(conn.sent).toEqual([{ t: "game.ask", target: "bob", card: "5H" }]);
  });

  it("tells me I'm offline instead of silently dropping an action", async () => {
    const conn = await renderRoom();
    start(conn);
    conn.accept = false;
    fireEvent.click(screen.getByRole("radio", { name: setInfo("LOW_H").name }));
    fireEvent.click(screen.getByRole("radio", { name: cardLabel("5H") }));
    fireEvent.click(screen.getByRole("radio", { name: /^Bob/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Ask Bob/ }));
    expect(await screen.findByText("You’re offline. Reconnecting…")).toBeTruthy();
  });
});

describe("RoomPage: events and toasts", () => {
  it("shows a spotlight for a failed ask, then the result", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(
      conn,
      { t: "game.event", event: { type: "askFailed", asker: "bob", target: "me", card: "2H" } },
      { t: "game.event", event: { type: "turnChanged", player: "me" } },
    );
    expect(screen.getByText("Asking…")).toBeTruthy();
    expect(await screen.findByText("Failed ask", {}, { timeout: 2500 })).toBeTruthy();
    expect(screen.getByText("You don’t have it — Your turn")).toBeTruthy();
    // The spotlight already says whose turn it is, so there is no separate turn toast.
    expect(screen.queryByText("Your turn.")).toBeNull();
  });

  it("toasts a declaration in plain words", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, {
      t: "game.event",
      event: { type: "declared", player: "maya", team: "A", set: "LOW_H", assignment: {}, holders: {}, correct: true, outcome: "WON_A" },
    });
    expect(await screen.findByText(`Maya declared ${setInfo("LOW_H").name} — correct. Team A +1`)).toBeTruthy();
  });

  it("toasts a wrong declaration, and a nullified one", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, { t: "game.event", event: wrongHighC }, { t: "game.event", event: wrongHighD });
    expect(await screen.findByText(`Bob declared ${setInfo("HIGH_C").name} — wrong. Team A +1`)).toBeTruthy();
    expect(await screen.findByText(`Bob declared ${setInfo("HIGH_D").name} — wrong. The set is nullified.`)).toBeTruthy();
  });

  it("toasts whose turn it is after a choice", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, { t: "game.event", event: { type: "turnChanged", player: "bob" } });
    expect(await screen.findByText("Bob’s turn.")).toBeTruthy();
  });

  it("merges a timeout and its turn change into one toast", async () => {
    const conn = await renderRoom();
    start(conn, makeView({ phase: { kind: "turn", player: "bob" } }));
    deliver(
      conn,
      { t: "game.event", event: { type: "timedOut", phase: "turn" } },
      { t: "game.event", event: { type: "turnChanged", player: "priya" } },
    );
    expect(await screen.findByText("Time’s up for Bob. Priya’s turn.")).toBeTruthy();
  });

  it("shows at most two toasts at once", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(
      conn,
      { t: "game.event", event: { type: "turnChanged", player: "bob" } },
      { t: "game.event", event: { type: "turnChanged", player: "priya" } },
      { t: "game.event", event: { type: "turnChanged", player: "frank" } },
    );
    expect(await screen.findByText("Frank’s turn.")).toBeTruthy();
    expect(screen.queryByText("Bob’s turn.")).toBeNull();
    expect(screen.getByText("Priya’s turn.")).toBeTruthy();
  });

  it("shows a server error as a toast", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, { t: "error", code: "NOT_YOUR_TURN", message: "It's not your turn." });
    expect(await screen.findByText("It's not your turn.")).toBeTruthy();
  });

  it("does not replay events the client has already handled", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, { t: "game.event", event: { type: "turnChanged", player: "bob" } });
    await screen.findByText("Bob’s turn.");
    deliver(conn, { t: "game.view", view: makeView(), turnDeadline: null });
    expect(screen.getAllByText("Bob’s turn.")).toHaveLength(1);
  });
});

describe("RoomPage: wrong declarations", () => {
  it("opens a popup showing who really held each card", async () => {
    const conn = await renderRoom();
    start(conn);
    expect(screen.queryByRole("dialog")).toBeNull();
    deliver(conn, { t: "game.event", event: wrongHighC });
    const popup = await screen.findByRole("dialog", { name: /Wrong declaration/ });
    expect(within(popup).getByRole("heading", { name: setInfo("HIGH_C").full })).toBeTruthy();
    expect(within(popup).getByText("Declared by Bob. Team A +1")).toBeTruthy();
    const rows = within(popup).getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    // 10♣ was in my hand, though Bob named Priya.
    expect(within(rows[1]!).getByText("You")).toBeTruthy();
    expect(within(rows[1]!).getByText("Declared as Priya")).toBeTruthy();
  });

  it("is shown to the declarer too", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, { t: "game.event", event: { ...wrongHighC, player: "me", team: "A", outcome: "WON_B" } });
    expect(within(await screen.findByRole("dialog", { name: /Wrong declaration/ })).getByText("Declared by you. Team B +1")).toBeTruthy();
  });

  it("does not open for a correct declaration", async () => {
    const conn = await renderRoom();
    start(conn);
    const assignment = { "2H": "me", "3H": "me", "4H": "maya", "5H": "maya", "6H": "eve", "7H": "eve" };
    deliver(conn, {
      t: "game.event",
      event: { type: "declared", player: "maya", team: "A", set: "LOW_H", assignment, holders: assignment, correct: true, outcome: "WON_A" },
    });
    await screen.findByText(`Maya declared ${setInfo("LOW_H").name} — correct. Team A +1`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes with 'Got it', leaving the table as it was", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, { t: "game.event", event: wrongHighC });
    await screen.findByRole("dialog", { name: /Wrong declaration/ });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "Your hand" })).toBeTruthy();
  });

  it("queues a second wrong declaration behind the first, so neither goes unread", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, { t: "game.event", event: wrongHighC }, { t: "game.event", event: wrongHighD });
    await screen.findByRole("dialog", { name: /Wrong declaration/ });
    expect(within(dialog()).getByRole("heading", { name: setInfo("HIGH_C").full })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    fireEvent.click(within(dialog()).getByRole("button", { name: "Got it" }));
    expect(within(dialog()).getByRole("heading", { name: setInfo("HIGH_D").full })).toBeTruthy();
    expect(within(dialog()).getByText("Declared by Bob. The set is nullified.")).toBeTruthy();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is dropped by a rematch rather than left over the lobby", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, { t: "game.event", event: wrongHighC });
    await screen.findByRole("dialog", { name: /Wrong declaration/ });
    deliver(conn, { t: "room.state", room: makeRoom({ status: "lobby" }) });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Table rules" })).toBeTruthy();
  });
});

describe("RoomPage: connection state", () => {
  it("shows the reconnect banner, then 'back in your seat'", async () => {
    const conn = await renderRoom();
    start(conn);
    expect(screen.queryByText("Reconnecting…")).toBeNull();
    status(conn, "reconnecting", 1);
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
    status(conn, "open");
    expect(screen.getByText(/Connected\. You.re back in your seat\./)).toBeTruthy();
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });

  it("keeps showing the table while reconnecting", async () => {
    const conn = await renderRoom();
    start(conn);
    status(conn, "reconnecting", 1);
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  it("does not show 'back in your seat' on the very first connection", async () => {
    const conn = await renderRoom();
    status(conn, "open");
    expect(screen.queryByText(/back in your seat/)).toBeNull();
  });

  it("explains a game that has already started", async () => {
    const conn = await renderRoom();
    status(conn, "closed", 0, "ROOM_IN_PROGRESS");
    expect(screen.getByText("This game has already started")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use this tab" })).toBeNull();
  });

  it("explains a full room without offering a retry", async () => {
    const conn = await renderRoom();
    status(conn, "closed", 0, "ROOM_FULL");
    expect(screen.getByText("This room is full")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use this tab" })).toBeNull();
  });

  it("explains an unknown room", async () => {
    const conn = await renderRoom();
    status(conn, "closed", 0, "ROOM_NOT_FOUND");
    expect(screen.getByText("Room K7QX not found")).toBeTruthy();
  });

  it("lets me take the room back after another tab replaced this one", async () => {
    const conn = await renderRoom();
    status(conn, "closed", 0, "replaced");
    expect(screen.getByText("Open in another tab")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this tab" }));
    await waitFor(() => expect(conns).toHaveLength(2));
    expect(conn.closed).toBe(true);
  });
});

describe("RoomPage: game over", () => {
  const over = { ...makeView({ hand: [], scores: { A: 5, B: 3 }, transferCount: 20 }), phase: { kind: "over", result: "A" } as const };
  const finished = () => makeRoom({ status: "finished", startedAt: 1_700_000_000_000, endedAt: 1_700_000_000_000 + 5 * 60_000 });

  it("shows the game-over screen at once when joining a finished room", async () => {
    const conn = await renderRoom();
    status(conn, "open");
    deliver(conn, { t: "room.state", room: finished() }, { t: "game.view", view: over, turnDeadline: null });
    expect(screen.getByRole("heading", { name: "How the sets fell" })).toBeTruthy();
    expect(screen.getByText("You won")).toBeTruthy();
  });

  it("lets the last declaration sit on the table for a moment before the result", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(conn, { t: "room.state", room: finished() }, { t: "game.view", view: over, turnDeadline: null });
    expect(screen.queryByRole("heading", { name: "How the sets fell" })).toBeNull();
    expect(screen.getAllByText("Game over").length).toBeGreaterThan(0);
    expect(await screen.findByRole("heading", { name: "How the sets fell" }, { timeout: 3500 })).toBeTruthy();
    expect(screen.getByLabelText("Team A 5, Team B 3")).toBeTruthy();
  });

  it("keeps the last wrong declaration's reveal up when the game ends on it", async () => {
    const conn = await renderRoom();
    start(conn);
    deliver(
      conn,
      { t: "game.event", event: wrongHighC },
      { t: "game.event", event: { type: "gameOver", result: "A", scores: { A: 5, B: 3 } } },
      { t: "room.state", room: finished() },
      { t: "game.view", view: over, turnDeadline: null },
    );
    await screen.findByRole("dialog", { name: /Wrong declaration/ });
    expect(screen.queryByRole("heading", { name: "How the sets fell" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "How the sets fell" }, { timeout: 3500 })).toBeTruthy();
    expect(within(dialog()).getByRole("heading", { name: setInfo("HIGH_C").full })).toBeTruthy();
  });
});
