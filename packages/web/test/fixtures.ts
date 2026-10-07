import type { AskAttempt, Card, GameConfig, Phase, PlayerView, SetId, SetResolution, SetStatus, Team, ViewWithAsks } from "@litt/engine";
import { SET_IDS } from "@litt/engine";
import { DEFAULT_ROOM_CONFIG, type RoomConfig, type RoomPlayer, type RoomSnapshot } from "@litt/protocol";
import { sortCards } from "../src/lib/cards.js";
import { makeNamer } from "../src/game/text.js";

/** Seat order alternates teams. "me" is the viewer. */
export const SEAT_IDS = ["me", "bob", "maya", "priya", "eve", "frank"] as const;
export const TEAM: Record<string, Team> = { me: "A", bob: "B", maya: "A", priya: "B", eve: "A", frank: "B" };
export const NAMES: Record<string, string> = {
  me: "dharshen",
  bob: "Bob",
  maya: "Maya",
  priya: "Priya",
  eve: "Eve",
  frank: "Frank",
};

/** Low ♥ (partial), High ♣ (partial) and all of High ♠. */
export const DEFAULT_HAND: Card[] = ["3H", "7H", "KC", "9S", "10S", "JS", "QS", "KS", "AS"];

export interface ViewOptions {
  hand?: Card[];
  phase?: Phase;
  sets?: Partial<Record<SetId, SetStatus>>;
  /** Other players with no cards left. */
  out?: string[];
  config?: Partial<GameConfig>;
  transfers?: PlayerView["recentTransfers"];
  asks?: AskAttempt[];
  transferCount?: number;
  resolutions?: SetResolution[];
  scores?: PlayerView["scores"];
}

export function makeView(o: ViewOptions = {}): PlayerView & Partial<ViewWithAsks> {
  const hand = sortCards(o.hand ?? DEFAULT_HAND);
  const sets = Object.fromEntries(SET_IDS.map((s) => [s, "ACTIVE"])) as Record<SetId, SetStatus>;
  Object.assign(sets, o.sets);
  return {
    me: "me",
    myTeam: "A",
    hand,
    players: SEAT_IDS.map((id) => ({
      id,
      team: TEAM[id]!,
      outOfCards: id === "me" ? hand.length === 0 : (o.out?.includes(id) ?? false),
    })),
    sets,
    scores: o.scores ?? { A: 0, B: 0 },
    phase: o.phase ?? { kind: "turn", player: "me" },
    recentTransfers: o.transfers ?? [],
    ...(o.asks ? { recentAsks: o.asks } : {}),
    transferCount: o.transferCount ?? o.transfers?.length ?? 0,
    resolutions: o.resolutions ?? [],
    config: { wrongDeclaration: "award", historyLimit: 3, ...o.config },
  };
}

export interface RoomOptions {
  status?: RoomSnapshot["status"];
  hostId?: string;
  teams?: Record<string, Team | null>;
  players?: RoomPlayer[];
  config?: Partial<RoomConfig>;
  startedAt?: number | null;
  endedAt?: number | null;
}

export function makeRoom(o: RoomOptions = {}): RoomSnapshot {
  const players: RoomPlayer[] =
    o.players ??
    SEAT_IDS.map((id) => ({
      id,
      displayName: NAMES[id]!,
      avatarUrl: null,
      team: o.teams && id in o.teams ? o.teams[id]! : TEAM[id]!,
      connected: true,
    }));
  return {
    code: "K7QX",
    status: o.status ?? "playing",
    hostId: o.hostId ?? "me",
    players,
    config: { ...DEFAULT_ROOM_CONFIG, ...o.config },
    startedAt: o.startedAt ?? null,
    endedAt: o.endedAt ?? null,
  };
}

export const namerFor = (room: RoomSnapshot, me = "me") =>
  makeNamer(me, new Map(room.players.map((p) => [p.id, p.displayName])));
