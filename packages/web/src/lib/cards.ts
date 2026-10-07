import { ALL_CARDS, type Card, type SetId } from "@litt/engine";

// U+FE0E asks for the text (not emoji) glyph, which some fonts default to for ♥ and ♦.
const SUIT_SYMBOL = { C: "♣\uFE0E", D: "♦\uFE0E", H: "♥\uFE0E", S: "♠\uFE0E" } as const;
type SuitKey = keyof typeof SUIT_SYMBOL;

export interface CardFace {
  rank: string;
  suit: string;
  red: boolean;
  /** Human label, e.g. "5♥" or "Red Joker". */
  label: string;
}

export function cardFace(card: Card): CardFace {
  if (card === "JK1") return { rank: "JK", suit: "★", red: true, label: "Red Joker" };
  if (card === "JK2") return { rank: "JK", suit: "★", red: false, label: "Black Joker" };
  const suit = card.slice(-1) as SuitKey;
  const rank = card.slice(0, -1);
  return { rank, suit: SUIT_SYMBOL[suit], red: suit === "H" || suit === "D", label: rank + SUIT_SYMBOL[suit] };
}

export const cardLabel = (card: Card): string => cardFace(card).label;

const ORDER = new Map<Card, number>(ALL_CARDS.map((c, i) => [c, i]));
export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
}

interface SetInfo {
  /** Short name for chips and tiles: "Low ♥". */
  name: string;
  /** Full name for hand groups, review and results: "Low ♥ (2–7)". */
  full: string;
  range: string;
}

export function setInfo(set: SetId): SetInfo {
  if (set === "EIGHTS") return { name: "8s & J", full: "8s & Jokers", range: "8 · ★" };
  const [kind, suit] = set.split("_") as ["LOW" | "HIGH", SuitKey];
  const sym = SUIT_SYMBOL[suit];
  return kind === "LOW"
    ? { name: `Low ${sym}`, full: `Low ${sym} (2–7)`, range: "2–7" }
    : { name: `High ${sym}`, full: `High ${sym} (9–A)`, range: "9–A" };
}
