import { ALL_CARDS, SET_IDS, cardsInSet, isCard, isSetId, setOf } from "./cards.js";
import type { Card, SetId } from "./cards.js";
import { clone } from "./clone.js";
import { recordAsk } from "./asks.js";
import { pick } from "./rng.js";
import type {
  Action,
  ApplyResult,
  Assignment,
  ChooseReason,
  Chooser,
  CreateGameOptions,
  CreateGameResult,
  EngineError,
  ErrorCode,
  GameEvent,
  GameState,
  PlayerSeat,
  Rng,
  SetStatus,
  Team,
} from "./types.js";

type AskAction = Extract<Action, { type: "ask" }>;
type DeclareAction = Extract<Action, { type: "declare" }>;
type ChooseAction = Extract<Action, { type: "choose" }>;
type Outcome = Exclude<SetStatus, "ACTIVE">;

function fail(code: ErrorCode, message: string): { ok: false; error: EngineError } {
  return { ok: false, error: { code, message } };
}

const CARD_INDEX = new Map<Card, number>(ALL_CARDS.map((card, i) => [card, i]));

/** Sorts a hand in place into canonical ALL_CARDS order. */
function sortHand(hand: Card[]): Card[] {
  return hand.sort((a, b) => CARD_INDEX.get(a)! - CARD_INDEX.get(b)!);
}

const otherTeam = (team: Team): Team => (team === "A" ? "B" : "A");

function seat(state: GameState, id: unknown): PlayerSeat | undefined {
  return state.players.find((p) => p.id === id);
}

function handOf(state: GameState, id: string): Card[] {
  return state.hands[id] ?? [];
}

/** Players of `team` holding at least one card, in seat order. */
function withCards(state: GameState, team: Team, exclude?: string): string[] {
  return state.players
    .filter((p) => p.team === team && p.id !== exclude && handOf(state, p.id).length > 0)
    .map((p) => p.id);
}

// ---------------------------------------------------------------------------
// createGame

export function createGame(options: CreateGameOptions): CreateGameResult {
  const { players, config, deal, firstPlayer } = options;
  const rng = options.rng ?? Math.random;
  const invalid = (message: string) => fail("INVALID_SETUP", message);

  if (!Array.isArray(players) || players.length < 6) return invalid("At least 6 players are needed.");
  if (players.length % 2 !== 0) return invalid("The number of players must be even.");
  if (players.some((p) => typeof p.id !== "string" || p.id === "")) {
    return invalid("Every player needs an id.");
  }
  if (players.some((p) => p.team !== "A" && p.team !== "B")) {
    return invalid("Every player must be on team A or B.");
  }
  if (players.filter((p) => p.team === "A").length * 2 !== players.length) {
    return invalid("Both teams must have the same number of players.");
  }
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) return invalid("A player can only take one seat.");
  if (!Number.isInteger(config.historyLimit) || config.historyLimit < 1) {
    return invalid("The transfer history limit must be a whole number of at least 1.");
  }
  if (config.wrongDeclaration !== "award" && config.wrongDeclaration !== "null") {
    return invalid('Wrong declaration mode must be "award" or "null".');
  }
  if (firstPlayer !== undefined && !ids.has(firstPlayer)) {
    return invalid("The first player is not in this game.");
  }

  let hands: Record<string, Card[]>;
  if (deal !== undefined) {
    const checked = checkDeal(deal, players);
    if (typeof checked === "string") return invalid(checked);
    hands = checked;
  } else {
    hands = dealCards(players, rng);
  }

  let first: string;
  if (firstPlayer !== undefined) {
    if (hands[firstPlayer]!.length === 0) return invalid("The first player must hold cards.");
    first = firstPlayer;
  } else {
    first = pick(players.filter((p) => hands[p.id]!.length > 0), rng).id;
  }

  const sets = Object.fromEntries(SET_IDS.map((s) => [s, "ACTIVE"])) as Record<SetId, SetStatus>;
  return {
    ok: true,
    state: {
      config: { wrongDeclaration: config.wrongDeclaration, historyLimit: config.historyLimit },
      players: players.map((p) => ({ id: p.id, team: p.team })),
      hands,
      sets,
      scores: { A: 0, B: 0 },
      history: [],
      transferCount: 0,
      resolutions: [],
      phase: { kind: "turn", player: first },
    },
  };
}

function checkDeal(deal: Record<string, Card[]>, players: PlayerSeat[]): Record<string, Card[]> | string {
  if (typeof deal !== "object" || deal === null) return "The deal must map each player to a hand.";
  if (Object.keys(deal).length !== players.length || players.some((p) => !Object.hasOwn(deal, p.id))) {
    return "The deal must have exactly one hand per player.";
  }
  const seen = new Set<Card>();
  const hands: Record<string, Card[]> = {};
  for (const p of players) {
    const hand: unknown = deal[p.id];
    if (!Array.isArray(hand)) return "Every hand in the deal must be a list of cards.";
    for (const card of hand) {
      if (!isCard(card)) return `The deal contains an unknown card: ${String(card)}.`;
      if (seen.has(card)) return `The deal contains ${card} more than once.`;
      seen.add(card);
    }
    hands[p.id] = sortHand([...(hand as Card[])]);
  }
  if (seen.size !== ALL_CARDS.length) return "The deal must contain all 54 cards.";
  return hands;
}

/** Fisher–Yates shuffle, then round-robin from seat 0. */
function dealCards(players: PlayerSeat[], rng: Rng): Record<string, Card[]> {
  const deck = [...ALL_CARDS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const hands: Record<string, Card[]> = {};
  for (const p of players) hands[p.id] = [];
  deck.forEach((card, k) => hands[players[k % players.length]!.id]!.push(card));
  for (const p of players) sortHand(hands[p.id]!);
  return hands;
}

// ---------------------------------------------------------------------------
// apply

export function apply(state: GameState, action: Action, rng: Rng = Math.random): ApplyResult {
  if (state.phase.kind === "over") return fail("GAME_OVER", "The game is over.");
  switch (action.type) {
    case "ask":
      return ask(state, action);
    case "declare":
      return declare(state, action);
    case "choose":
      return choose(state, action);
    case "timeout":
      return timeout(state, rng);
    default:
      return fail("WRONG_PHASE", "Unknown action.");
  }
}

function ask(state: GameState, { player, target, card }: AskAction): ApplyResult {
  const { phase } = state;
  if (phase.kind !== "turn") return fail("WRONG_PHASE", "You can't ask for a card right now.");
  const asker = seat(state, player);
  if (!asker) return fail("UNKNOWN_PLAYER", "You are not playing in this game.");
  if (phase.player !== player) return fail("NOT_YOUR_TURN", "It's not your turn.");
  const victim = seat(state, target);
  if (!victim) return fail("UNKNOWN_PLAYER", "That player is not in this game.");
  if (!isCard(card)) return fail("UNKNOWN_CARD", "That is not a card in this deck.");
  if (victim.team === asker.team) return fail("TARGET_NOT_OPPONENT", "You can only ask an opponent for a card.");
  if (handOf(state, target).length === 0) return fail("TARGET_HAS_NO_CARDS", "That player has no cards left.");
  const set = setOf(card);
  if (state.sets[set] !== "ACTIVE") return fail("SET_NOT_ACTIVE", "That card's set has already been resolved.");
  const hand = handOf(state, player);
  if (hand.includes(card)) return fail("ALREADY_HOLD_CARD", "You already hold that card.");
  if (!hand.some((c) => setOf(c) === set)) {
    return fail("NO_BASE_CARD", "You must hold another card from that set to ask for it.");
  }

  const next = clone(state);
  const ok = handOf(next, target).includes(card);
  recordAsk(next, { asker: player, target, card, ok });
  if (!ok) {
    next.phase = { kind: "turn", player: target };
    return {
      ok: true,
      state: next,
      events: [
        { type: "askFailed", asker: player, target, card },
        { type: "turnChanged", player: target },
      ],
    };
  }

  next.hands[target] = handOf(next, target).filter((c) => c !== card);
  next.hands[player] = sortHand([...handOf(next, player), card]);
  next.transferCount += 1;
  next.history.push({ seq: next.transferCount, from: target, to: player, card });
  next.history = next.history.slice(-next.config.historyLimit);
  return { ok: true, state: next, events: [{ type: "askSucceeded", asker: player, target, card }] };
}

function declare(state: GameState, { player, set, assignment }: DeclareAction): ApplyResult {
  const { phase } = state;
  if (phase.kind !== "turn") return fail("WRONG_PHASE", "You can't declare right now.");
  const declarer = seat(state, player);
  if (!declarer) return fail("UNKNOWN_PLAYER", "You are not playing in this game.");
  if (phase.player !== player) return fail("NOT_YOUR_TURN", "It's not your turn.");
  if (!isSetId(set)) return fail("UNKNOWN_SET", "That is not a set.");
  if (state.sets[set] !== "ACTIVE") return fail("SET_NOT_ACTIVE", "That set has already been resolved.");
  const setCards = cardsInSet(set);
  if (!handOf(state, player).some((c) => setOf(c) === set)) {
    return fail("NO_BASE_CARD", "You must hold a card from a set to declare it.");
  }
  const problem = checkAssignment(state, declarer.team, setCards, assignment);
  if (problem) return fail("INVALID_ASSIGNMENT", problem);

  const team = declarer.team;
  const other = otherTeam(team);
  const assigned = Object.fromEntries(setCards.map((c) => [c, assignment[c]!])) as Assignment;
  const holders = holdersOf(state, setCards);
  const correct = setCards.every((c) => holders[c] === assigned[c]);
  const outcome: Outcome = correct
    ? `WON_${team}`
    : state.config.wrongDeclaration === "award"
      ? `WON_${other}`
      : "NULL";

  const next = clone(state);
  next.sets[set] = outcome;
  if (outcome === "WON_A") next.scores.A += 1;
  if (outcome === "WON_B") next.scores.B += 1;
  for (const p of next.players) {
    next.hands[p.id] = handOf(next, p.id).filter((c) => setOf(c) !== set);
  }
  next.resolutions.push({ set, declaredBy: player, team, correct, outcome });

  const events: GameEvent[] = [
    { type: "declared", player, team, set, assignment: assigned, holders, correct, outcome },
  ];

  if (SET_IDS.every((s) => next.sets[s] !== "ACTIVE")) {
    const { A, B } = next.scores;
    const result = A > B ? "A" : B > A ? "B" : "draw";
    next.phase = { kind: "over", result };
    events.push({ type: "gameOver", result, scores: { A, B } });
    return { ok: true, state: next, events };
  }

  const { chooser, eligible, reason } = handOff(next, player, team, correct);
  if (eligible.length === 1) {
    next.phase = { kind: "turn", player: eligible[0]! };
    events.push({ type: "turnChanged", player: eligible[0]! });
  } else {
    next.phase = { kind: "choose", chooser, eligible, reason };
    events.push({ type: "chooseRequired", chooser: { ...chooser }, eligible: [...eligible], reason });
  }
  return { ok: true, state: next, events };
}

/** Who really holds each of `cards`, in the order given. Call before the set's cards leave the hands. */
function holdersOf(state: GameState, cards: readonly Card[]): Assignment {
  const holders: Assignment = {};
  for (const card of cards) {
    const holder = state.players.find((p) => handOf(state, p.id).includes(card));
    if (holder) holders[card] = holder.id;
  }
  return holders;
}

/** Returns a player-facing problem with the assignment, or undefined if it is well-formed. */
function checkAssignment(
  state: GameState,
  team: Team,
  setCards: readonly Card[],
  assignment: unknown,
): string | undefined {
  if (typeof assignment !== "object" || assignment === null || Array.isArray(assignment)) {
    return "Assign each card of the set to a player on your team.";
  }
  for (const key of Object.keys(assignment)) {
    if (!setCards.includes(key as Card)) return "The declaration includes a card that isn't in that set.";
  }
  for (const card of setCards) {
    if (!Object.hasOwn(assignment, card)) return "Assign all 6 cards of the set.";
    const assignee = seat(state, (assignment as Record<string, unknown>)[card]);
    if (!assignee) return "Every card must be assigned to a player in this game.";
    if (assignee.team !== team) return "You can only assign cards to players on your team.";
  }
  return undefined;
}

/** Who picks the next active player after a declaration (ARCHITECTURE §4.5). */
function handOff(
  state: GameState,
  declarer: string,
  team: Team,
  correct: boolean,
): { chooser: Chooser; eligible: string[]; reason: ChooseReason } {
  const other = otherTeam(team);
  const ours = withCards(state, team);
  const theirs = withCards(state, other);
  if (correct) {
    return ours.length > 0
      ? { chooser: { player: declarer }, eligible: ours, reason: "correctDeclaration" }
      : { chooser: { team: other }, eligible: theirs, reason: "declarerTeamEmpty" };
  }
  return theirs.length > 0
    ? { chooser: { team: other }, eligible: theirs, reason: "wrongDeclaration" }
    : { chooser: { team }, eligible: ours, reason: "opponentsEmpty" };
}

function choose(state: GameState, { player, choice }: ChooseAction): ApplyResult {
  const { phase } = state;
  if (phase.kind !== "choose") return fail("WRONG_PHASE", "There is no choice to make right now.");
  const chooserSeat = seat(state, player);
  if (!chooserSeat) return fail("UNKNOWN_PLAYER", "You are not playing in this game.");
  const isChooser =
    "player" in phase.chooser
      ? phase.chooser.player === player
      : phase.chooser.team === chooserSeat.team;
  if (!isChooser) return fail("NOT_CHOOSER", "It's not your choice to make.");
  if (!phase.eligible.includes(choice)) return fail("NOT_ELIGIBLE", "That player can't take the turn.");

  const next = clone(state);
  next.phase = { kind: "turn", player: choice };
  return { ok: true, state: next, events: [{ type: "turnChanged", player: choice }] };
}

function timeout(state: GameState, rng: Rng): ApplyResult {
  const { phase } = state;
  let player: string;
  if (phase.kind === "turn") {
    const active = seat(state, phase.player)!;
    const opponents = withCards(state, otherTeam(active.team));
    const teammates = withCards(state, active.team, active.id);
    if (opponents.length > 0) player = pick(opponents, rng);
    else if (teammates.length > 0) player = pick(teammates, rng);
    else player = active.id;
  } else if (phase.kind === "choose") {
    player = pick(phase.eligible, rng);
  } else {
    return fail("GAME_OVER", "The game is over.");
  }

  const next = clone(state);
  next.phase = { kind: "turn", player };
  return {
    ok: true,
    state: next,
    events: [
      { type: "timedOut", phase: phase.kind },
      { type: "turnChanged", player },
    ],
  };
}
