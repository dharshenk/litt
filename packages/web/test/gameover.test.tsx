import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { PlayerView, SetResolution } from "@litt/engine";
import type { ClientMessage, RoomSnapshot } from "@litt/protocol";
import { setInfo } from "../src/lib/cards.js";
import { GameOver } from "../src/room/GameOver.js";
import { makeRoom, makeView } from "./fixtures.js";

const MIN = 60_000;
const START = 1_700_000_000_000;

const res = (set: SetResolution["set"], declaredBy: string, correct: boolean, outcome: SetResolution["outcome"]): SetResolution => ({
  set,
  declaredBy,
  team: declaredBy === "me" || declaredBy === "maya" || declaredBy === "eve" ? "A" : "B",
  correct,
  outcome,
});

const RESOLUTIONS: SetResolution[] = [
  res("LOW_C", "maya", true, "WON_A"),
  res("HIGH_H", "bob", true, "WON_B"),
  res("EIGHTS", "priya", false, "NULL"),
  res("LOW_D", "me", true, "WON_A"),
];

function finalView(result: "A" | "B" | "draw", scores = { A: 5, B: 3 }, extra: Partial<PlayerView> = {}): PlayerView {
  return {
    ...makeView({ hand: [], scores, transferCount: 47, resolutions: RESOLUTIONS }),
    phase: { kind: "over", result },
    ...extra,
  };
}

function renderOver(opts: { view?: PlayerView | null; room?: RoomSnapshot; meId?: string } = {}) {
  const send = vi.fn<(msg: ClientMessage) => void>();
  const room = opts.room ?? makeRoom({ status: "finished", startedAt: START, endedAt: START + 38 * MIN });
  render(
    <MemoryRouter initialEntries={["/r/K7QX"]}>
      <Routes>
        <Route path="/" element={<div>home page</div>} />
        <Route
          path="/r/:code"
          element={<GameOver room={room} view={opts.view === undefined ? finalView("A") : opts.view} meId={opts.meId ?? "me"} send={send} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return { send };
}

const headline = () => screen.getByRole("heading", { level: 1 }).textContent;

describe("GameOver: result", () => {
  it("shows 'You won' and the winning team", () => {
    renderOver({ view: finalView("A") });
    expect(screen.getByText("You won")).toBeTruthy();
    expect(headline()).toBe("Team Awins.");
  });

  it("shows 'You lost' when the other team won", () => {
    renderOver({ view: finalView("B", { A: 3, B: 5 }) });
    expect(screen.getByText("You lost")).toBeTruthy();
    expect(headline()).toBe("Team Bwins.");
  });

  it("shows 'Final' and a draw", () => {
    renderOver({ view: finalView("draw", { A: 4, B: 4 }) });
    expect(screen.getByText("Final")).toBeTruthy();
    expect(headline()).toBe("It’s adraw.");
  });

  it("derives the kicker from my team, so a team-B player who won sees 'You won'", () => {
    renderOver({ view: { ...finalView("B", { A: 3, B: 5 }), me: "bob", myTeam: "B" }, meId: "bob" });
    expect(screen.getByText("You won")).toBeTruthy();
  });

  it("shows the score for each team", () => {
    renderOver();
    expect(screen.getByLabelText("Team A 5, Team B 3").textContent).toBe("5to3");
  });
});

describe("GameOver: meta line", () => {
  it("is built from nulls, transferCount and the room's start and end times", () => {
    renderOver();
    expect(screen.getByText("1 set nullified · 47 transfers · 38 min")).toBeTruthy();
  });

  it("pluralizes nulls and rounds minutes up to at least 1", () => {
    const view = finalView("A", { A: 5, B: 2 }, {
      resolutions: [res("LOW_C", "bob", false, "NULL"), res("LOW_D", "bob", false, "NULL")],
      transferCount: 1,
    });
    renderOver({ view, room: makeRoom({ status: "finished", startedAt: START, endedAt: START + 10_000 }) });
    expect(screen.getByText("2 sets nullified · 1 transfer · 1 min")).toBeTruthy();
  });

  it("leaves out nulls when there are none", () => {
    renderOver({ view: finalView("A", { A: 5, B: 3 }, { resolutions: [res("LOW_C", "maya", true, "WON_A")] }) });
    expect(screen.getByText("47 transfers · 38 min")).toBeTruthy();
  });

  it("leaves out the duration when the times are unknown", () => {
    renderOver({ room: makeRoom({ status: "finished", startedAt: null, endedAt: null }) });
    expect(screen.getByText("1 set nullified · 47 transfers")).toBeTruthy();
  });
});

describe("GameOver: how the sets fell", () => {
  it("lists every resolution in declared order with who declared it", () => {
    renderOver();
    const list = screen.getByRole("heading", { name: "How the sets fell" }).parentElement!;
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.firstElementChild!.textContent)).toEqual(RESOLUTIONS.map((r) => setInfo(r.set).full));
    expect(rows.map((r) => r.children[1]!.textContent)).toEqual([
      "Declared by Maya",
      "Declared by Bob",
      "Wrong · Priya",
      "Declared by You",
    ]);
  });

  it("labels each outcome", () => {
    renderOver();
    const rows = within(screen.getByRole("heading", { name: "How the sets fell" }).parentElement!).getAllByRole("listitem");
    expect(rows.map((r) => r.lastElementChild!.textContent)).toEqual(["Team A", "Team B", "Null", "Team A"]);
    expect(rows.map((r) => r.lastElementChild!.getAttribute("data-outcome"))).toEqual(["WON_A", "WON_B", "NULL", "WON_A"]);
  });

  it("still renders when only the room is known (no view yet)", () => {
    renderOver({ view: null });
    expect(screen.getByRole("heading", { name: "How the sets fell" })).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("GameOver: buttons", () => {
  it("gives the host a Rematch button that sends room.rematch", () => {
    const { send } = renderOver();
    fireEvent.click(screen.getByRole("button", { name: "Rematch" }));
    expect(send).toHaveBeenCalledWith({ t: "room.rematch" });
  });

  it("does not offer Rematch to anyone else", () => {
    const view = { ...finalView("A"), me: "maya" };
    renderOver({ view, meId: "maya" });
    expect(screen.queryByRole("button", { name: "Rematch" })).toBeNull();
  });

  it("offers Back to home to everyone", () => {
    renderOver({ meId: "maya" });
    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));
    expect(screen.getByText("home page")).toBeTruthy();
  });
});
