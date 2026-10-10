import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cardLabel, setInfo } from "../src/lib/cards.js";
import type { DeclaredEvent } from "../src/game/text.js";
import { DeclarationReveal } from "../src/table/DeclarationReveal.js";
import { TEAM, makeRoom, namerFor } from "./fixtures.js";

const namer = namerFor(makeRoom());
const teamOf = (id: string) => TEAM[id] ?? null;

/** Team B declares High ♣ and gets two cards wrong: 10♣ was in my hand, and A♣ was with Priya, not Bob. */
const highC = (o: Partial<DeclaredEvent> = {}): DeclaredEvent => ({
  type: "declared",
  player: "bob",
  team: "B",
  set: "HIGH_C",
  assignment: { "9C": "bob", "10C": "priya", JC: "bob", QC: "frank", KC: "priya", AC: "bob" },
  holders: { "9C": "bob", "10C": "me", JC: "bob", QC: "frank", KC: "priya", AC: "priya" },
  correct: false,
  outcome: "WON_A",
  ...o,
});

/** Maya (team A) declares Low ♥: Eve, not me, had 2♥, and Bob had 5♥. */
const lowH = (o: Partial<DeclaredEvent> = {}): DeclaredEvent => ({
  type: "declared",
  player: "maya",
  team: "A",
  set: "LOW_H",
  assignment: { "2H": "me", "3H": "me", "4H": "maya", "5H": "maya", "6H": "eve", "7H": "eve" },
  holders: { "2H": "eve", "3H": "me", "4H": "maya", "5H": "bob", "6H": "eve", "7H": "eve" },
  correct: false,
  outcome: "WON_B",
  ...o,
});

function renderReveal(event: DeclaredEvent = highC()) {
  const onClose = vi.fn();
  const utils = render(<DeclarationReveal event={event} namer={namer} teamOf={teamOf} onClose={onClose} />);
  return { onClose, ...utils };
}

const rows = () => within(screen.getByRole("list", { name: "Who held each card" })).queryAllByRole("listitem");

describe("DeclarationReveal: what it says", () => {
  it("names the set, the declarer and what the mistake cost", () => {
    renderReveal();
    const dialog = screen.getByRole("dialog", { name: /Wrong declaration/ });
    expect(within(dialog).getByRole("heading", { name: setInfo("HIGH_C").full })).toBeTruthy();
    expect(within(dialog).getByText("Declared by Bob. Team A +1")).toBeTruthy();
  });

  it("says so when the set is nullified, and speaks to me when I declared", () => {
    renderReveal(highC({ player: "me", team: "A", outcome: "NULL" }));
    expect(screen.getByText("Declared by you. The set is nullified.")).toBeTruthy();
  });

  it("lists the real holder of every card, in set order", () => {
    renderReveal();
    const list = rows();
    expect(list).toHaveLength(6);
    (
      [
        ["9C", "Bob"],
        ["10C", "You"],
        ["JC", "Bob"],
        ["QC", "Frank"],
        ["KC", "Priya"],
        ["AC", "Priya"],
      ] as const
    ).forEach(([card, holder], i) => {
      expect(within(list[i]!).getByText(cardLabel(card))).toBeTruthy();
      expect(within(list[i]!).getByText(holder)).toBeTruthy();
    });
  });

  it("flags the cards the declarer got wrong, and who they named instead", () => {
    renderReveal();
    const wrong = rows().filter((row) => row.hasAttribute("data-wrong"));
    expect(wrong).toHaveLength(2);
    expect(within(wrong[0]!).getByText(cardLabel("10C"))).toBeTruthy();
    expect(within(wrong[0]!).getByText("Declared as Priya")).toBeTruthy();
    expect(within(wrong[1]!).getByText(cardLabel("AC"))).toBeTruthy();
    expect(within(wrong[1]!).getByText("Declared as Bob")).toBeTruthy();
    for (const row of wrong) expect(within(row).getByText("Wrong.")).toBeTruthy();
  });

  it("leaves the cards they got right unremarked", () => {
    renderReveal();
    const right = rows().filter((row) => !row.hasAttribute("data-wrong"));
    expect(right).toHaveLength(4);
    for (const row of right) {
      expect(within(row).getByText("Correct.")).toBeTruthy();
      expect(within(row).queryByText(/Declared as/)).toBeNull();
    }
  });

  it("says 'you' when the declarer named me, and shows an opponent who held a card", () => {
    renderReveal(lowH());
    const [first, , , fourth] = rows();
    expect(within(first!).getByText("Eve")).toBeTruthy();
    expect(within(first!).getByText("Declared as you")).toBeTruthy();
    expect(within(fourth!).getByText("Bob")).toBeTruthy();
    expect(within(fourth!).getByText("Declared as Maya")).toBeTruthy();
  });

  it("colours each holder's avatar by their own team, so an opponent's card stands out", () => {
    renderReveal(lowH());
    const teams = rows().map((row) => row.querySelector("[data-team]")?.getAttribute("data-team"));
    expect(teams).toEqual(["A", "A", "A", "B", "A", "A"]);
  });

  it("handles the eights and jokers set", () => {
    renderReveal(
      highC({
        set: "EIGHTS",
        assignment: { "8C": "bob", "8D": "bob", "8H": "priya", "8S": "priya", JK1: "frank", JK2: "frank" },
        holders: { "8C": "bob", "8D": "bob", "8H": "priya", "8S": "priya", JK1: "frank", JK2: "me" },
      }),
    );
    expect(screen.getByRole("heading", { name: setInfo("EIGHTS").full })).toBeTruthy();
    expect(within(rows()[4]!).getByText("Red Joker")).toBeTruthy();
    expect(within(rows()[5]!).getByText("Black Joker")).toBeTruthy();
    expect(within(rows()[5]!).getByText("You")).toBeTruthy();
    expect(within(rows()[5]!).getByText("Declared as Frank")).toBeTruthy();
  });

  it("shows no rows rather than guessing when it doesn't know who held the cards", () => {
    renderReveal(highC({ holders: {} }));
    expect(rows()).toHaveLength(0);
  });
});

describe("DeclarationReveal: dismissing", () => {
  it("closes from the button", () => {
    const { onClose } = renderReveal();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape", () => {
    const { onClose } = renderReveal();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks on the backdrop, so a stray click can't dismiss it unread", () => {
    const { onClose } = renderReveal();
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("takes focus when it appears and keeps it inside", () => {
    renderReveal();
    const close = screen.getByRole("button", { name: "Got it" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("hands focus back to whatever had it before", () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    const { unmount } = renderReveal();
    expect(document.activeElement).not.toBe(before);
    unmount();
    expect(document.activeElement).toBe(before);
    before.remove();
  });
});
