// CONTRACT FILE — shared by all packages. Do not change without agreement;
// see tasks/README.md ("Contract changes").

import type { Card, SetId } from "./cards.js";

export type Team = "A" | "B";

/** Returns a float in [0, 1), like Math.random. Injected so tests are deterministic. */
export type Rng = () => number;

export type WrongDeclarationMode = "award" | "null";

export interface GameConfig {
  /** rules §14: what happens to a wrongly declared set. */
  wrongDeclaration: WrongDeclarationMode;
  /** rules §18: how many recent successful transfers are queryable. Default 3. */
  historyLimit: number;
}

export interface PlayerSeat {
  id: string;
  team: Team;
}

export type SetStatus = "ACTIVE" | "WON_A" | "WON_B" | "NULL";

/** A successful card transfer caused by a correct ask. */
export interface Transfer {
  /** 1-based, increases with every successful transfer in the game. */
  seq: number;
  from: string;
  to: string;
  card: Card;
}

/** How a set left play. Public information (declarations are announced). */
export interface SetResolution {
  set: SetId;
  declaredBy: string;
  team: Team;
  correct: boolean;
  outcome: Exclude<SetStatus, "ACTIVE">;
}

export type ChooseReason =
  /** Correct declaration: declarer passes the turn within their team (§34.1.1). */
  | "correctDeclaration"
  /** Correct declaration emptied the declarer's team: opponents choose (§34.1.6). */
  | "declarerTeamEmpty"
  /** Wrong declaration: opposing team chooses (§34.1.2). */
  | "wrongDeclaration"
  /** Wrong declaration but opponents have no cards: declaring team chooses (§34.1.13). */
  | "opponentsEmpty";

/** Either one specific player chooses, or any member of a team may choose. */
export type Chooser = { player: string } | { team: Team };

export type Phase =
  | { kind: "turn"; player: string }
  | { kind: "choose"; chooser: Chooser; eligible: string[]; reason: ChooseReason }
  | { kind: "over"; result: Team | "draw" };

export interface GameState {
  config: GameConfig;
  /** Seat order. */
  players: PlayerSeat[];
  /** Cards currently in play, per player. Resolved sets' cards are removed. */
  hands: Record<string, Card[]>;
  sets: Record<SetId, SetStatus>;
  scores: Record<Team, number>;
  /** Only the last `config.historyLimit` transfers; older ones are discarded. */
  history: Transfer[];
  /** Total successful transfers so far (used for Transfer.seq). */
  transferCount: number;
  /** Resolved sets, in the order they were declared. */
  resolutions: SetResolution[];
  phase: Phase;
}

/** Declaration: who on the declarer's team holds each of the set's 6 cards. */
export type Assignment = Partial<Record<Card, string>>;

export type Action =
  | { type: "ask"; player: string; target: string; card: Card }
  | { type: "declare"; player: string; set: SetId; assignment: Assignment }
  | { type: "choose"; player: string; choice: string }
  /** Server-only: the turn timer expired for the current phase (§34.1.12). */
  | { type: "timeout" };

export type GameEvent =
  | { type: "askSucceeded"; asker: string; target: string; card: Card }
  | { type: "askFailed"; asker: string; target: string; card: Card }
  | {
      type: "declared";
      player: string;
      team: Team;
      set: SetId;
      /** What the declarer claimed: who holds each of the set's 6 cards. */
      assignment: Assignment;
      /**
       * Where each of the set's 6 cards really was. Public once declared: the cards leave
       * play, and a wrong declaration shows everyone who had what. Equals `assignment` when correct.
       */
      holders: Assignment;
      correct: boolean;
      outcome: Exclude<SetStatus, "ACTIVE">;
    }
  | { type: "chooseRequired"; chooser: Chooser; eligible: string[]; reason: ChooseReason }
  | { type: "turnChanged"; player: string }
  | { type: "timedOut"; phase: "turn" | "choose" }
  | { type: "gameOver"; result: Team | "draw"; scores: Record<Team, number> };

export type ErrorCode =
  | "INVALID_SETUP"
  | "GAME_OVER"
  | "WRONG_PHASE"
  | "NOT_YOUR_TURN"
  | "UNKNOWN_PLAYER"
  | "UNKNOWN_CARD"
  | "UNKNOWN_SET"
  | "TARGET_NOT_OPPONENT"
  | "TARGET_HAS_NO_CARDS"
  | "SET_NOT_ACTIVE"
  | "ALREADY_HOLD_CARD"
  | "NO_BASE_CARD"
  | "INVALID_ASSIGNMENT"
  | "NOT_CHOOSER"
  | "NOT_ELIGIBLE";

export interface EngineError {
  code: ErrorCode;
  message: string;
}

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: EngineError };

export interface CreateGameOptions {
  players: PlayerSeat[];
  config: GameConfig;
  rng?: Rng;
  /** Fixed deal (tests). Must contain all 54 cards exactly once. Default: shuffle and deal. */
  deal?: Record<string, Card[]>;
  /** Fixed first player (tests). Default: random. */
  firstPlayer?: string;
}

export type CreateGameResult =
  | { ok: true; state: GameState }
  | { ok: false; error: EngineError };

/** The only shape of an in-progress game that may leave the server for a given player. */
export interface PlayerView {
  me: string;
  myTeam: Team;
  hand: Card[];
  /** Hand sizes are deliberately absent (§34.1.7); only out-of-cards is public (§34.1.11). */
  players: { id: string; team: Team; outOfCards: boolean }[];
  sets: Record<SetId, SetStatus>;
  scores: Record<Team, number>;
  phase: Phase;
  recentTransfers: Transfer[];
  /** Total successful transfers so far (public: every transfer is announced). */
  transferCount: number;
  resolutions: SetResolution[];
  config: GameConfig;
}

/** The engine's public API, as implemented in game.ts / view.ts and exported from index.ts. */
export interface Engine {
  createGame(options: CreateGameOptions): CreateGameResult;
  /** Pure: never mutates `state`. Illegal actions return { ok: false }. */
  apply(state: GameState, action: Action, rng?: Rng): ApplyResult;
  playerView(state: GameState, playerId: string): PlayerView;
}
