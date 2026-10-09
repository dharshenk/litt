import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, PlayerView, SetId } from "@litt/engine";
import { getRecentAsks } from "@litt/engine";
import type { ClientMessage } from "@litt/protocol";
import { ToastProvider } from "../src/components/Toasts.js";
import { cardLabel, setInfo } from "../src/lib/cards.js";
import { Table } from "../src/table/Table.js";
import { AskSpotlight, type Spot } from "../src/table/AskSpotlight.js";
import { MockServer } from "../src/mock/server.js";
import { makeRoom, makeView, namerFor, type ViewOptions } from "./fixtures.js";
import { setMobile } from "./viewport.js";

type TableProps = ComponentProps<typeof Table>;

function renderTable(options: ViewOptions = {}, extra: Partial<TableProps> = {}, view: PlayerView = makeView(options)) {
  const send = vi.fn<(msg: ClientMessage) => void>();
  const room = makeRoom({ config: { wrongDeclaration: view.config.wrongDeclaration } });
  const utils = render(
    <ToastProvider>
      <Table
        room={room}
        view={view}
        deadline={null}
        namer={namerFor(room)}
        send={send}
        spot={null}
        onSpotDone={() => {}}
        uiKey="test"
        errorId={0}
        {...extra}
      />
    </ToastProvider>,
  );
  return { send, view, room, ...utils };
}

const radio = (name: string | RegExp, scope: { getByRole: typeof screen.getByRole } = screen) =>
  scope.getByRole("radio", { name }) as HTMLInputElement;
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const setChip = (set: SetId) => radio(setInfo(set).name);
const cardLabels = (el: HTMLElement) => within(el).getAllByRole("img").map((c) => c.getAttribute("aria-label"));

describe("Mock transactions", () => {
  it("keeps successful and failed scripted asks in one bounded history", () => {
    const server = new MockServer();
    const view = makeView({ config: { historyLimit: 2 } });
    server.load(makeRoom({ config: { turnSeconds: null } }), view);
    server.apply([{ type: "askSucceeded", asker: "maya", target: "bob", card: "2C" }], view);
    server.apply([{ type: "askFailed", asker: "maya", target: "bob", card: "3C" }], view);
    server.apply([{ type: "askFailed", asker: "bob", target: "eve", card: "4C" }], view);
    expect(getRecentAsks(server.current().view!)).toEqual([
      { seq: 2, asker: "maya", target: "bob", card: "3C", ok: false },
      { seq: 3, asker: "bob", target: "eve", card: "4C", ok: false },
    ]);
  });
});

describe("Table: hand", () => {
  it("groups my hand by set, in canonical order", () => {
    renderTable();
    const hand = screen.getByRole("region", { name: "Your hand" });
    const groups = within(hand)
      .getAllByRole("group")
      .map((group) => [group.getAttribute("aria-label"), cardLabels(group)]);
    expect(groups).toEqual([
      [setInfo("LOW_H").full, ["3H", "7H"].map((c) => cardLabel(c as Card))],
      [setInfo("HIGH_C").full, [cardLabel("KC")]],
      [setInfo("HIGH_S").full, ["9S", "10S", "JS", "QS", "KS", "AS"].map((c) => cardLabel(c as Card))],
    ]);
  });

  it("labels the eights and jokers group", () => {
    renderTable({ hand: ["8C", "JK1", "JK2"] });
    const group = screen.getByRole("group", { name: "8s & Jokers" });
    expect(cardLabels(group)).toEqual([cardLabel("8C"), "Red Joker", "Black Joker"]);
    expect(within(group).getByLabelText("3 of 6 held").textContent).toBe("3 / 6");
  });

  it("says so when I am out of cards", () => {
    renderTable({ hand: [] });
    expect(screen.getByText("You are out of cards. Your team plays on.")).toBeTruthy();
  });

  it("lifts the group of the set being asked about", () => {
    renderTable();
    fireEvent.click(setChip("LOW_H"));
    const group = screen.getByRole("group", { name: setInfo("LOW_H").full });
    expect(group.hasAttribute("data-lifted")).toBe(true);
    expect(screen.getByRole("group", { name: setInfo("HIGH_S").full }).hasAttribute("data-lifted")).toBe(false);
  });
});

describe("Table: players, sets and header", () => {
  it("shows both rows with each team's label, and never a hand size", () => {
    renderTable({ out: ["frank"] });
    expect(screen.getByText("Opponents · Team B")).toBeTruthy();
    expect(screen.getByText("Your team · Team A")).toBeTruthy();
    for (const name of ["Bob", "Priya", "Frank", "Maya", "Eve"]) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\b\d+\s+cards?\b/i);
  });

  it("marks out-of-cards players and the active player", () => {
    renderTable({ out: ["frank"] });
    expect(screen.getAllByText("Out of cards").length).toBeGreaterThan(0);
    const active = document.querySelector('[aria-current="true"]')!;
    expect(active.textContent).toContain("You");
    expect(active.textContent).toContain("Playing");
  });

  it("shows the score and the resolved sets", () => {
    renderTable({ sets: { LOW_D: "WON_A", HIGH_H: "WON_B", LOW_S: "NULL" }, scores: { A: 1, B: 1 } });
    expect(screen.getByLabelText("Score: Team A 1, Team B 1")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Sets" })).toBeNull();
    fireEvent.click(button("Sets"));
    const dialog = screen.getByRole("dialog", { name: "Sets" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByText("6 active · 3 resolved")).toBeTruthy();
    expect(screen.getByText("Null")).toBeTruthy();
  });

  it("closes the sets popup with its button or Escape and restores focus", () => {
    renderTable();
    const trigger = button("Sets");
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Sets" })).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Sets" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Sets" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Sets" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("header says whose turn it is", () => {
    renderTable();
    expect(screen.getByText("Your turn")).toBeTruthy();
  });

  it("someone else's turn: the pill and the panel name them, and there are no ask controls", () => {
    renderTable({ phase: { kind: "turn", player: "bob" } });
    expect(screen.getAllByText("Bob’s turn")).toHaveLength(2);
    expect(screen.queryByRole("radio", { name: "Ask" })).toBeNull();
    expect(screen.getByText(/Watch who asks for what/)).toBeTruthy();
  });

  it("a teammate's turn gets a teammate message", () => {
    renderTable({ phase: { kind: "turn", player: "maya" } });
    expect(screen.getByText("Your teammate is asking. Watch the transfers.")).toBeTruthy();
  });

  it("shows a calm timer ring while there is plenty of time", () => {
    renderTable({}, { deadline: Date.now() + 30_000 });
    expect(screen.getByRole("timer").hasAttribute("data-warn")).toBe(false);
  });

  it("turns the timer into a warning in the last 10 seconds", () => {
    renderTable({}, { deadline: Date.now() + 8_500 });
    const timer = screen.getByRole("timer");
    expect(timer.hasAttribute("data-warn")).toBe(true);
    expect(timer.getAttribute("aria-label")).toMatch(/^\d+ seconds left$/);
  });

  it("has no timer without a deadline", () => {
    renderTable();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("toggles sound from the header and remembers it", () => {
    renderTable();
    fireEvent.click(button("Mute sounds"));
    expect(window.localStorage.getItem("litt_muted")).toBe("1");
    fireEvent.click(button("Unmute sounds"));
    expect(window.localStorage.getItem("litt_muted")).toBeNull();
  });
});

describe("Table: recent transactions", () => {
  const transfers = [
    { seq: 12, from: "bob", to: "maya", card: "6C" as Card },
    { seq: 13, from: "priya", to: "eve", card: "JS" as Card },
    { seq: 14, from: "bob", to: "maya", card: "2C" as Card },
  ];

  it("lists them newest first, numbered by seq", () => {
    renderTable({ transfers, transferCount: 14 });
    const region = screen.getByRole("region", { name: "Recent transactions" });
    const rows = within(region).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("#14"),
      expect.stringContaining("#13"),
      expect.stringContaining("#12"),
    ]);
    expect(rows[0]!.textContent).toContain("Bob → Maya");
    expect(within(region).getByText("last 3")).toBeTruthy();
  });

  it("only shows historyLimit entries", () => {
    renderTable({ transfers, transferCount: 14, config: { historyLimit: 2 } });
    const region = screen.getByRole("region", { name: "Recent transactions" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says when there are none", () => {
    renderTable();
    expect(screen.getByText("No transactions yet.")).toBeTruthy();
  });

  it("includes failed asks in the latest three rather than retaining older successes", () => {
    renderTable({ transfers, asks: [
      { seq: 12, asker: "maya", target: "bob", card: "6C", ok: true },
      { seq: 13, asker: "eve", target: "priya", card: "JS", ok: true },
      { seq: 14, asker: "maya", target: "bob", card: "2C", ok: true },
      { seq: 15, asker: "maya", target: "bob", card: "3C", ok: false },
    ] });
    const rows = within(screen.getByRole("region", { name: "Recent transactions" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("#15Maya → Bob"),
      expect.stringContaining("#14Bob → Maya"),
      expect.stringContaining("#13Priya → Eve"),
    ]);
    expect(within(rows[0]!).getByText("Failed")).toBeTruthy();
    expect(within(rows[1]!).getByText("Received")).toBeTruthy();
  });

  it("tags a failed ask Now while its spotlight is up", () => {
    const spot: Spot = { id: 1, asker: "maya", target: "bob", card: "3C", ok: false };
    renderTable({ asks: [{ seq: 1, asker: "maya", target: "bob", card: "3C", ok: false }] }, { spot });
    const row = within(screen.getByRole("region", { name: "Recent transactions" })).getByRole("listitem");
    expect(within(row).getByText("Now")).toBeTruthy();
    expect(row.getAttribute("data-ok")).toBe("false");
  });

  it("tags the newest transfer 'Now' while its spotlight is up", () => {
    const spot: Spot = { id: 1, asker: "maya", target: "bob", card: "2C", ok: true };
    renderTable({ transfers, transferCount: 14 }, { spot });
    expect(screen.getByText("Now")).toBeTruthy();
  });
});

describe("Table: ask panel", () => {
  it("only offers sets I hold and am missing a card from", () => {
    renderTable();
    const group = screen.getByRole("radiogroup", { name: "Set to ask from" });
    const names = within(group)
      .getAllByRole("radio")
      .map((r) => r.closest("label")!.textContent);
    // HIGH_S is fully in my hand, LOW_C and the rest are not held.
    expect(names).toEqual([setInfo("LOW_H").name, setInfo("HIGH_C").name]);
  });

  it("only offers cards I don't hold, once a set is picked", () => {
    renderTable();
    expect(screen.queryByRole("radiogroup", { name: /Pick a card/ })).toBeNull();
    fireEvent.click(setChip("LOW_H"));
    const cards = screen.getByRole("radiogroup", { name: /Pick a card/ });
    expect(cardLabels(cards)).toEqual(["2H", "4H", "5H", "6H"].map((c) => cardLabel(c as Card)));
  });

  it("only offers opponents, and disables those out of cards", () => {
    renderTable({ out: ["frank"] });
    fireEvent.click(setChip("LOW_H"));
    const targets = screen.getByRole("radiogroup", { name: /Pick an opponent/ });
    expect(within(targets).queryByRole("radio", { name: /Maya|Eve|You/ })).toBeNull();
    expect(radio(/^Bob/, within(targets)).disabled).toBe(false);
    expect(radio(/^Priya/, within(targets)).disabled).toBe(false);
    expect(radio(/^Frank/, within(targets)).disabled).toBe(true);
    expect(within(targets).getByText("Out of cards")).toBeTruthy();
  });

  it("walks through set, card and opponent, then sends game.ask", () => {
    const { send } = renderTable();
    expect(button("Pick a set").disabled).toBe(true);
    fireEvent.click(setChip("LOW_H"));
    expect(button("Pick a card").disabled).toBe(true);
    fireEvent.click(radio(cardLabel("5H")));
    expect(button("Pick an opponent").disabled).toBe(true);
    fireEvent.click(radio(/^Bob/));
    const ask = button(`Ask Bob for ${cardLabel("5H")}`);
    expect(ask.disabled).toBe(false);
    fireEvent.click(ask);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ t: "game.ask", target: "bob", card: "5H" });
  });

  it("can't send twice while waiting for the server", () => {
    const { send } = renderTable();
    fireEvent.click(setChip("LOW_H"));
    fireEvent.click(radio(cardLabel("5H")));
    fireEvent.click(radio(/^Bob/));
    const ask = button(/^Ask Bob/);
    fireEvent.click(ask);
    fireEvent.click(ask);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("forgets a picked card when the set changes", () => {
    renderTable();
    fireEvent.click(setChip("LOW_H"));
    fireEvent.click(radio(cardLabel("5H")));
    fireEvent.click(setChip("HIGH_C"));
    expect(button("Pick a card")).toBeTruthy();
  });

  it("tells me to declare when every opponent is out of cards", () => {
    renderTable({ out: ["bob", "priya", "frank"] });
    expect(screen.getByText("Every opponent is out of cards. Declare a set instead.")).toBeTruthy();
    fireEvent.click(setChip("LOW_H"));
    expect(screen.queryByRole("radiogroup", { name: /Pick an opponent/ })).toBeNull();
  });

  it("tells me to declare when I hold every card of my sets", () => {
    renderTable({ hand: ["9S", "10S", "JS", "QS", "KS", "AS"] });
    expect(screen.getByText("You hold every card of your sets. Declare one instead.")).toBeTruthy();
  });
});

describe("Table: declare panel", () => {
  const declareTab = { initialTab: "declare" } as const;
  const groupFor = (card: Card, mine = false) =>
    screen.getByRole("radiogroup", { name: `Who holds ${cardLabel(card)}${mine ? " (yours)" : ""}` });

  it("only offers sets I hold at least one card of", () => {
    renderTable({}, declareTab);
    const group = screen.getByRole("radiogroup", { name: "Set to declare" });
    expect(within(group).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual([
      setInfo("LOW_H").name,
      setInfo("HIGH_C").name,
      setInfo("HIGH_S").name,
    ]);
  });

  it("prefills my own cards and locks them", () => {
    renderTable({}, declareTab);
    fireEvent.click(setChip("LOW_H"));
    for (const card of ["3H", "7H"] as Card[]) {
      const group = groupFor(card, true);
      const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
      expect(radios.every((r) => r.disabled)).toBe(true);
      expect(radio("You", within(group)).checked).toBe(true);
    }
  });

  it("lets me assign the cards I don't hold, starting unassigned", () => {
    renderTable({}, declareTab);
    fireEvent.click(setChip("LOW_H"));
    for (const card of ["2H", "4H", "5H", "6H"] as Card[]) {
      const radios = within(groupFor(card)).getAllByRole("radio") as HTMLInputElement[];
      expect(radios.map((r) => r.disabled)).toEqual([false, false, false]);
      expect(radios.some((r) => r.checked)).toBe(false);
    }
    expect(button("Assign 4 more").disabled).toBe(true);
  });

  it("counts down the cards still to assign, then offers review", () => {
    renderTable({}, declareTab);
    fireEvent.click(setChip("LOW_H"));
    fireEvent.click(radio("Maya", within(groupFor("2H"))));
    expect(button("Assign 3 more")).toBeTruthy();
    fireEvent.click(radio("Maya", within(groupFor("4H"))));
    fireEvent.click(radio("Eve", within(groupFor("5H"))));
    expect(button("Assign 1 more")).toBeTruthy();
    fireEvent.click(radio("Eve", within(groupFor("6H"))));
    expect(button("Review declaration").disabled).toBe(false);
  });

  it("can be declared immediately when I hold the whole set", () => {
    renderTable({}, declareTab);
    fireEvent.click(setChip("HIGH_S"));
    expect(button("Review declaration").disabled).toBe(false);
  });

  it("offers only teammates, and disables one who is out of cards", () => {
    renderTable({ out: ["maya"] }, declareTab);
    fireEvent.click(setChip("LOW_H"));
    const group = groupFor("2H");
    expect(within(group).queryByRole("radio", { name: /Bob|Priya|Frank/ })).toBeNull();
    expect(radio("Maya", within(group)).disabled).toBe(true);
    expect(radio("Eve", within(group)).disabled).toBe(false);
  });

  it("reviews the declaration grouped by teammate, then sends game.declare with all six cards", () => {
    const { send } = renderTable({}, declareTab);
    fireEvent.click(setChip("LOW_H"));
    fireEvent.click(radio("Maya", within(groupFor("2H"))));
    fireEvent.click(radio("Maya", within(groupFor("4H"))));
    fireEvent.click(radio("Eve", within(groupFor("5H"))));
    fireEvent.click(radio("Eve", within(groupFor("6H"))));
    fireEvent.click(button("Review declaration"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(setInfo("LOW_H").full)).toBeTruthy();
    expect(within(dialog).getByText("This cannot be undone. A wrong declaration gives the set to the other team.")).toBeTruthy();
    // Cards are grouped under each teammate's name.
    const row = (name: string) => within(dialog).getByText(name).parentElement!.textContent;
    expect(row("You")).toBe(`You${cardLabel("3H")}${cardLabel("7H")}`);
    expect(row("Maya")).toBe(`Maya${cardLabel("2H")}${cardLabel("4H")}`);
    expect(row("Eve")).toBe(`Eve${cardLabel("5H")}${cardLabel("6H")}`);

    expect(send).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Declare set" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      t: "game.declare",
      set: "LOW_H",
      assignment: { "2H": "maya", "3H": "me", "4H": "maya", "5H": "eve", "6H": "eve", "7H": "me" },
    });
  });

  it("warns that the set is nullified in null mode", () => {
    renderTable({ config: { wrongDeclaration: "null" } }, declareTab);
    fireEvent.click(setChip("HIGH_S"));
    fireEvent.click(button("Review declaration"));
    expect(screen.getByText("This cannot be undone. A wrong declaration nullifies the set.")).toBeTruthy();
  });

  it("Back and Esc close the review without sending", () => {
    const { send } = renderTable({}, declareTab);
    fireEvent.click(setChip("HIGH_S"));
    fireEvent.click(button("Review declaration"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button("Review declaration"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("traps focus inside the review dialog", () => {
    renderTable({}, declareTab);
    fireEvent.click(setChip("HIGH_S"));
    fireEvent.click(button("Review declaration"));
    const dialog = screen.getByRole("dialog");
    const back = within(dialog).getByRole("button", { name: "Back" });
    const confirm = within(dialog).getByRole("button", { name: "Declare set" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(back, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("says when I hold no cards to declare from", () => {
    renderTable({ hand: [] }, declareTab);
    expect(screen.getByText("You need at least one card from a set to declare it.")).toBeTruthy();
  });
});

describe("Table: choose phase", () => {
  const choosing = (chooser: { player: string } | { team: "A" | "B" }, reason: "correctDeclaration" | "wrongDeclaration" | "opponentsEmpty" | "declarerTeamEmpty" = "correctDeclaration") =>
    ({
      phase: { kind: "choose", chooser, eligible: ["me", "maya", "eve"], reason },
    }) satisfies ViewOptions;

  it("shows the picker when I am the named chooser", () => {
    const { send } = renderTable(choosing({ player: "me" }));
    expect(screen.getByRole("heading", { name: "Pick who plays next" })).toBeTruthy();
    expect(screen.getByText("You declared correctly")).toBeTruthy();
    expect(screen.getByText("You pick next")).toBeTruthy();
    const choices = screen.getAllByRole("button", { name: /Play →/ });
    expect(choices).toHaveLength(3);
    ["You", "Maya", "Eve"].forEach((name, i) => expect(within(choices[i]!).getByText(name)).toBeTruthy());
    fireEvent.click(button(/Maya/));
    expect(send).toHaveBeenCalledWith({ t: "game.choose", player: "maya" });
  });

  it("shows the picker to any member of the choosing team", () => {
    renderTable(choosing({ team: "A" }, "wrongDeclaration"));
    expect(screen.getByRole("heading", { name: "Pick who plays next" })).toBeTruthy();
    expect(screen.getByText("Your team gets the turn")).toBeTruthy();
  });

  it("uses a different kicker when my team keeps the turn", () => {
    renderTable(choosing({ team: "A" }, "opponentsEmpty"));
    expect(screen.getByText("Your team keeps the turn")).toBeTruthy();
  });

  it("does not show the picker when the other team is choosing", () => {
    renderTable({ phase: { kind: "choose", chooser: { team: "B" }, eligible: ["bob", "priya"], reason: "wrongDeclaration" } });
    expect(screen.queryByRole("heading", { name: "Pick who plays next" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Play →/ })).toBeNull();
    expect(screen.getByText("Waiting for Team B to pick who plays next")).toBeTruthy();
    expect(screen.getByText("Team B choosing")).toBeTruthy();
  });

  it("does not show the picker when another player is the named chooser", () => {
    renderTable({ phase: { kind: "choose", chooser: { player: "bob" }, eligible: ["bob"], reason: "correctDeclaration" } });
    expect(screen.queryByRole("button", { name: /Play →/ })).toBeNull();
    expect(screen.getByText("Waiting for Bob to pick who plays next")).toBeTruthy();
    expect(screen.getByText("Bob is choosing")).toBeTruthy();
  });

  it("has no ask or declare controls while choosing", () => {
    renderTable(choosing({ player: "me" }));
    expect(screen.queryByRole("radiogroup", { name: "Action" })).toBeNull();
  });
});

describe("Table: phone layout", () => {
  it("replaces the side panel with a bottom bar that opens a sheet", () => {
    setMobile(true);
    renderTable();
    expect(screen.queryByRole("complementary", { name: "Actions" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button("Ask"));
    const sheet = screen.getByRole("dialog", { name: "Actions" });
    expect(within(sheet).getByText("1 · Pick a set you hold")).toBeTruthy();
  });

  it("opens the sheet on the Declare tab from the Declare button", () => {
    setMobile(true);
    renderTable();
    fireEvent.click(button("Declare"));
    expect(within(screen.getByRole("dialog")).getByRole("radiogroup", { name: "Set to declare" })).toBeTruthy();
  });

  it("closes the sheet with Esc or the scrim", () => {
    setMobile(true);
    renderTable();
    fireEvent.click(button("Ask"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button("Ask"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the transfers inline above the hand", () => {
    setMobile(true);
    renderTable({ transfers: [{ seq: 1, from: "bob", to: "maya", card: "2C" }], transferCount: 1 });
    const region = screen.getByRole("region", { name: "Recent transactions" });
    expect(region.textContent).toContain("Bob → Maya");
  });

  it("offers a single 'Pick who plays next' action to the chooser, and opens the sheet for them", () => {
    setMobile(true);
    renderTable({ phase: { kind: "choose", chooser: { player: "me" }, eligible: ["me", "maya"], reason: "correctDeclaration" } });
    expect(button("Pick who plays next")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Pick who plays next" })).toBeTruthy();
  });

  it("shows a status line instead of buttons on someone else's turn", () => {
    setMobile(true);
    renderTable({ phase: { kind: "turn", player: "bob" } });
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    expect(screen.getByText("Bob’s turn — watch the table")).toBeTruthy();
  });
});

describe("AskSpotlight", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const namer = namerFor(makeRoom());
  const teamOf = (id: string) => (["me", "maya", "eve"].includes(id) ? "A" : "B") as "A" | "B";
  const spot = (o: Partial<Spot> = {}): Spot => ({ id: 1, asker: "me", target: "bob", card: "5H", ok: true, ...o });

  function renderSpot(s: Spot, transferSeq: number | null = 15) {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<AskSpotlight spot={s} namer={namer} teamOf={teamOf} transferSeq={transferSeq} onDone={onDone} />);
    const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
    return { onDone, advance };
  }

  it("starts as 'Asking…', then reveals a successful transfer", () => {
    const { advance } = renderSpot(spot());
    const box = screen.getByRole("status");
    expect(box.getAttribute("aria-live")).toBe("polite");
    expect(within(box).getByText("Asking…")).toBeTruthy();
    expect(box.getAttribute("data-outcome")).toBe("pending");
    advance(1200);
    expect(within(box).getByText("Transfer #15")).toBeTruthy();
    expect(within(box).getByText(`Bob had it — ${cardLabel("5H")} goes to you`)).toBeTruthy();
    expect(box.getAttribute("data-outcome")).toBe("ok");
  });

  it("reveals a failed ask and whose turn it becomes", () => {
    const { advance } = renderSpot(spot({ ok: false }), null);
    advance(1200);
    const box = screen.getByRole("status");
    expect(within(box).getByText("Failed ask")).toBeTruthy();
    expect(within(box).getByText("Bob doesn’t have it — Bob’s turn")).toBeTruthy();
    expect(box.getAttribute("data-outcome")).toBe("bad");
  });

  it("speaks in the second person when I am the one who was asked", () => {
    const { advance } = renderSpot(spot({ asker: "bob", target: "me", ok: false }), null);
    advance(1200);
    expect(screen.getByText("You don’t have it — Your turn")).toBeTruthy();
    expect(screen.getByText("asks")).toBeTruthy();
  });

  it("fades out at 5.7s and reports done at 6.1s", () => {
    const { advance, onDone } = renderSpot(spot());
    advance(1000);
    expect(screen.getByRole("status").hasAttribute("data-visible")).toBe(true);
    advance(4700);
    expect(screen.getByRole("status").hasAttribute("data-visible")).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
    advance(400);
    expect(onDone).toHaveBeenCalledWith(1);
  });

  it("renders nothing without a spot", () => {
    render(<AskSpotlight spot={null} namer={namer} teamOf={teamOf} transferSeq={null} onDone={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
