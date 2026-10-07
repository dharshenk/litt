// Client-side mirror of the engine's ask/declare rules, used only to disable illegal options.
// The server stays authoritative.

import { SET_IDS, cardsInSet, isCard, setOf, type Assignment, type Card, type PlayerView, type SetId } from "@litt/engine";

type ViewPlayer = PlayerView["players"][number];

export function isMyTurn(view: PlayerView): boolean {
  return view.phase.kind === "turn" && view.phase.player === view.me;
}

/** I may choose when I'm the named chooser, or when my team chooses. */
export function canIChoose(view: PlayerView): boolean {
  const { phase } = view;
  if (phase.kind !== "choose") return false;
  return "player" in phase.chooser ? phase.chooser.player === view.me : phase.chooser.team === view.myTeam;
}

export function opponents(view: PlayerView): ViewPlayer[] {
  return view.players.filter((p) => p.team !== view.myTeam);
}

/** My team in seat order, including me. */
export function teammates(view: PlayerView): ViewPlayer[] {
  return view.players.filter((p) => p.team === view.myTeam);
}

/** Active sets I hold at least one card of (also the sets I may declare). */
export function heldSets(view: PlayerView): SetId[] {
  return SET_IDS.filter((s) => view.sets[s] === "ACTIVE" && view.hand.some((c) => setOf(c) === s));
}

export const declarableSets = heldSets;

/** Held active sets where I'm missing at least one card. */
export function askableSets(view: PlayerView): SetId[] {
  return heldSets(view).filter((s) => cardsInSet(s).some((c) => !view.hand.includes(c)));
}

/** Cards of `set` I could ask for: the ones I don't hold, if the set is askable. */
export function askableCards(view: PlayerView, set: SetId): Card[] {
  if (!askableSets(view).includes(set)) return [];
  return cardsInSet(set).filter((c) => !view.hand.includes(c));
}

/** Opponents who can be asked: those with cards (§34.1.5). */
export function askTargets(view: PlayerView): string[] {
  return opponents(view)
    .filter((p) => !p.outOfCards)
    .map((p) => p.id);
}

/** Why an ask would be rejected, in the engine's check order, or null if it's legal. */
export function askProblem(view: PlayerView, target: string, card: Card): string | null {
  if (!isMyTurn(view)) return "It's not your turn.";
  const victim = view.players.find((p) => p.id === target);
  if (!victim) return "That player is not in this game.";
  if (!isCard(card)) return "That is not a card in this deck.";
  if (victim.team === view.myTeam) return "You can only ask an opponent for a card.";
  if (victim.outOfCards) return "That player has no cards left.";
  const set = setOf(card);
  if (view.sets[set] !== "ACTIVE") return "That card's set has already been resolved.";
  if (view.hand.includes(card)) return "You already hold that card.";
  if (!view.hand.some((c) => setOf(c) === set)) return "You must hold another card from that set to ask for it.";
  return null;
}

export const canAsk = (view: PlayerView, target: string, card: Card) => askProblem(view, target, card) === null;

/** Cards of `set` in my hand: prefilled with me and locked in the declare panel. */
export function lockedCards(view: PlayerView, set: SetId): Card[] {
  return cardsInSet(set).filter((c) => view.hand.includes(c));
}

/** Teammates a card can be assigned to. Empty-handed teammates can't hold anything. */
export function assignableTeammates(view: PlayerView): string[] {
  return teammates(view)
    .filter((p) => p.id === view.me || !p.outOfCards)
    .map((p) => p.id);
}

/** The user's picks with my own cards forced to me, restricted to the set's cards and valid teammates. */
export function effectiveAssignment(view: PlayerView, set: SetId, picks: Assignment): Assignment {
  const allowed = new Set(assignableTeammates(view));
  const out: Assignment = {};
  for (const card of cardsInSet(set)) {
    if (view.hand.includes(card)) out[card] = view.me;
    else {
      const who = picks[card];
      if (who !== undefined && allowed.has(who)) out[card] = who;
    }
  }
  return out;
}

export function unassignedCount(view: PlayerView, set: SetId, picks: Assignment): number {
  const a = effectiveAssignment(view, set, picks);
  return cardsInSet(set).filter((c) => a[c] === undefined).length;
}

/** Well-formed declaration: I hold the set, it's my turn, and every card goes to a teammate. */
export function canDeclare(view: PlayerView, set: SetId, picks: Assignment): boolean {
  return isMyTurn(view) && declarableSets(view).includes(set) && unassignedCount(view, set, picks) === 0;
}
