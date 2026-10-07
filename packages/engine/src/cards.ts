export const SUITS = ["C", "D", "H", "S"] as const;
export type Suit = (typeof SUITS)[number];

export const LOW_RANKS = ["2", "3", "4", "5", "6", "7"] as const;
export const HIGH_RANKS = ["9", "10", "J", "Q", "K", "A"] as const;

export type Rank = (typeof LOW_RANKS)[number] | "8" | (typeof HIGH_RANKS)[number];

/** A card id: rank + suit (e.g. "10H", "QS"), or "JK1" / "JK2" for the Jokers. */
export type Card = `${Rank}${Suit}` | "JK1" | "JK2";

export type SetId =
  | `LOW_${Suit}`
  | `HIGH_${Suit}`
  | "EIGHTS";

export const SET_IDS: readonly SetId[] = [
  ...SUITS.map((s) => `LOW_${s}` as const),
  ...SUITS.map((s) => `HIGH_${s}` as const),
  "EIGHTS",
];

const SET_CARDS = new Map<SetId, readonly Card[]>();
for (const suit of SUITS) {
  SET_CARDS.set(`LOW_${suit}`, LOW_RANKS.map((r) => `${r}${suit}` as Card));
  SET_CARDS.set(`HIGH_${suit}`, HIGH_RANKS.map((r) => `${r}${suit}` as Card));
}
SET_CARDS.set("EIGHTS", [...SUITS.map((s) => `8${s}` as Card), "JK1", "JK2"]);

const CARD_TO_SET = new Map<Card, SetId>();
for (const [setId, cards] of SET_CARDS) {
  for (const card of cards) CARD_TO_SET.set(card, setId);
}

/** All 54 cards. */
export const ALL_CARDS: readonly Card[] = [...CARD_TO_SET.keys()];

export function isCard(value: unknown): value is Card {
  return typeof value === "string" && CARD_TO_SET.has(value as Card);
}

export function isSetId(value: unknown): value is SetId {
  return typeof value === "string" && SET_CARDS.has(value as SetId);
}

export function cardsInSet(setId: SetId): readonly Card[] {
  return SET_CARDS.get(setId)!;
}

export function setOf(card: Card): SetId {
  return CARD_TO_SET.get(card)!;
}
