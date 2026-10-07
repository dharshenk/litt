// Hand-written fixtures for mock mode. No engine: views are built directly.

import {
  SET_IDS,
  setOf,
  type Card,
  type GameConfig,
  type Phase,
  type PlayerView,
  type SetId,
  type SetResolution,
  type SetStatus,
  type Team,
} from "@litt/engine";
import { DEFAULT_ROOM_CONFIG, type PlayerStats, type RoomConfig, type RoomPlayer, type RoomSnapshot, type UserProfile } from "@litt/protocol";
import { sortCards } from "../lib/cards.js";

export const CODE = "K7QX";

const person = (id: string, displayName: string): UserProfile => ({ id, displayName, avatarUrl: null });

export const ME = person("u-dharshen", "dharshen");
export const P = {
  me: ME.id,
  maya: "u-maya",
  eve: "u-eve",
  bob: "u-bob",
  priya: "u-priya",
  frank: "u-frank",
} as const;

const PROFILES: UserProfile[] = [
  ME,
  person(P.bob, "Bob"),
  person(P.maya, "Maya"),
  person(P.priya, "Priya"),
  person(P.eve, "Eve"),
  person(P.frank, "Frank"),
];

/** Seat order alternates teams: A1, B1, A2, B2, A3, B3. */
export const SEATS: { id: string; team: Team }[] = [
  { id: P.me, team: "A" },
  { id: P.bob, team: "B" },
  { id: P.maya, team: "A" },
  { id: P.priya, team: "B" },
  { id: P.eve, team: "A" },
  { id: P.frank, team: "B" },
];

export const teamOf = (id: string): Team => SEATS.find((s) => s.id === id)?.team ?? "A";
export const teammatesOf = (team: Team) => SEATS.filter((s) => s.team === team).map((s) => s.id);

export function makeRoom(opts: {
  status: RoomSnapshot["status"];
  hostId?: string;
  teams?: Record<string, Team | null>;
  config?: Partial<RoomConfig>;
  disconnected?: string[];
  startedAt?: number | null;
  endedAt?: number | null;
}): RoomSnapshot {
  const players: RoomPlayer[] = PROFILES.map((p) => ({
    ...p,
    team: opts.teams ? (opts.teams[p.id] ?? null) : teamOf(p.id),
    connected: !opts.disconnected?.includes(p.id),
  }));
  return {
    code: CODE,
    status: opts.status,
    hostId: opts.hostId ?? P.me,
    players,
    config: { ...DEFAULT_ROOM_CONFIG, ...opts.config },
    startedAt: opts.startedAt ?? (opts.status === "lobby" ? null : Date.now() - 12 * 60_000),
    endedAt: opts.endedAt ?? null,
  };
}

export const LOBBY_SETUP: Record<string, Team | null> = {
  [P.me]: "A",
  [P.maya]: "A",
  [P.bob]: "B",
  [P.priya]: "B",
  [P.eve]: null,
  [P.frank]: null,
};

export const LOBBY_READY: Record<string, Team | null> = Object.fromEntries(SEATS.map((s) => [s.id, s.team]));

type Resolved = [set: SetId, declaredBy: string, correct: boolean, outcome: Exclude<SetStatus, "ACTIVE">];
type Move = [from: string, to: string, card: Card];

export interface ViewSpec {
  hand: Card[];
  phase: Phase;
  resolved?: Resolved[];
  /** Other players with no cards left. */
  out?: string[];
  /** Recent transfers, oldest first; numbered so the last one is `transferCount`. */
  transfers?: Move[];
  transferCount?: number;
  config?: Partial<GameConfig>;
}

export function makeView(spec: ViewSpec): PlayerView {
  const config: GameConfig = { wrongDeclaration: "award", historyLimit: 3, ...spec.config };
  const sets = Object.fromEntries(SET_IDS.map((s) => [s, "ACTIVE"])) as Record<SetId, SetStatus>;
  const resolutions: SetResolution[] = (spec.resolved ?? []).map(([set, declaredBy, correct, outcome]) => {
    sets[set] = outcome;
    return { set, declaredBy, team: teamOf(declaredBy), correct, outcome };
  });
  const scores = {
    A: SET_IDS.filter((s) => sets[s] === "WON_A").length,
    B: SET_IDS.filter((s) => sets[s] === "WON_B").length,
  };
  const hand = sortCards(spec.hand.filter((c) => sets[setOf(c)] === "ACTIVE"));
  const transferCount = spec.transferCount ?? spec.transfers?.length ?? 0;
  const moves = (spec.transfers ?? []).slice(-config.historyLimit);
  const recentTransfers = moves.map(([from, to, card], i) => ({
    seq: transferCount - moves.length + 1 + i,
    from,
    to,
    card,
  }));
  return {
    me: P.me,
    myTeam: teamOf(P.me),
    hand,
    players: SEATS.map((s) => ({
      id: s.id,
      team: s.team,
      outOfCards: s.id === P.me ? hand.length === 0 : (spec.out?.includes(s.id) ?? false),
    })),
    sets,
    scores,
    phase: spec.phase,
    recentTransfers,
    transferCount,
    resolutions,
    config,
  };
}

// ---------- Mid-game table ----------

export const MY_HAND: Card[] = ["4C", "3H", "7H", "10C", "KD", "9S", "QS", "8D", "JK1"];

export const MID_RESOLVED: Resolved[] = [
  ["LOW_D", P.maya, true, "WON_A"],
  ["HIGH_H", P.bob, true, "WON_B"],
  ["LOW_S", P.eve, true, "WON_A"],
];

export const MID_TRANSFERS: Move[] = [
  [P.bob, P.maya, "6C"],
  [P.priya, P.eve, "JS"],
  [P.maya, P.bob, "2C"],
];

export function midGame(phase: Phase, extra: Partial<ViewSpec> = {}): PlayerView {
  return makeView({
    hand: MY_HAND,
    phase,
    resolved: MID_RESOLVED,
    transfers: MID_TRANSFERS,
    transferCount: 14,
    ...extra,
  });
}

// ---------- Finished games ----------

export const FINAL_WIN: Resolved[] = [
  ["LOW_C", P.maya, true, "WON_A"],
  ["HIGH_H", P.bob, true, "WON_B"],
  ["LOW_S", P.eve, true, "WON_A"],
  ["EIGHTS", P.priya, false, "NULL"],
  ["HIGH_D", P.me, true, "WON_A"],
  ["LOW_D", P.maya, true, "WON_A"],
  ["HIGH_S", P.frank, true, "WON_B"],
  ["LOW_H", P.me, true, "WON_A"],
  ["HIGH_C", P.bob, true, "WON_B"],
];

export const FINAL_LOSS: Resolved[] = [
  ["LOW_C", P.bob, true, "WON_B"],
  ["HIGH_H", P.priya, true, "WON_B"],
  ["LOW_S", P.maya, false, "WON_B"],
  ["EIGHTS", P.me, true, "WON_A"],
  ["HIGH_D", P.frank, true, "WON_B"],
  ["LOW_D", P.eve, true, "WON_A"],
  ["HIGH_S", P.bob, true, "WON_B"],
  ["LOW_H", P.priya, true, "WON_B"],
  ["HIGH_C", P.me, true, "WON_A"],
];

export const FINAL_DRAW: Resolved[] = [
  ["LOW_C", P.maya, true, "WON_A"],
  ["HIGH_H", P.bob, true, "WON_B"],
  ["LOW_S", P.eve, true, "WON_A"],
  ["EIGHTS", P.frank, false, "NULL"],
  ["HIGH_D", P.priya, true, "WON_B"],
  ["LOW_D", P.me, true, "WON_A"],
  ["HIGH_S", P.frank, true, "WON_B"],
  ["LOW_H", P.maya, true, "WON_A"],
  ["HIGH_C", P.bob, true, "WON_B"],
];

export function finalView(resolved: Resolved[], mode: GameConfig["wrongDeclaration"], transferCount: number): PlayerView {
  const v = makeView({
    hand: [],
    phase: { kind: "turn", player: P.me },
    resolved,
    transfers: [
      [P.priya, P.maya, "KC"],
      [P.eve, P.bob, "5H"],
      [P.bob, P.me, "QC"],
    ],
    transferCount,
    out: SEATS.map((s) => s.id),
    config: { wrongDeclaration: mode },
  });
  const { A, B } = v.scores;
  return { ...v, phase: { kind: "over", result: A > B ? "A" : B > A ? "B" : "draw" } };
}

// ---------- Leaderboard ----------

const stat = (p: UserProfile, wins: number, losses: number, draws: number): PlayerStats => ({
  ...p,
  played: wins + losses + draws,
  wins,
  losses,
  draws,
});

export const LEADERBOARD: PlayerStats[] = [
  stat(person("u-priya", "Priya"), 29, 20, 2),
  stat(person("u-maya", "Maya"), 28, 12, 2),
  stat(ME, 24, 14, 1),
  stat(person("u-bob", "Bob"), 17, 15, 1),
  stat(person("u-eve", "Eve"), 13, 14, 1),
  stat(person("u-frank", "Frank"), 12, 18, 0),
  stat(person("u-leo", "Leo"), 3, 6, 0),
];
