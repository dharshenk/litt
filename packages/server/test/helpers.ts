import { SET_IDS, type Card, type Engine, type GameState } from "@litt/engine";
import type { ClientMessage, ServerMessage, UserProfile } from "@litt/protocol";
import { vi } from "vitest";
import { Room } from "../src/room.js";

export const users: UserProfile[] = Array.from({ length: 6 }, (_, index) => ({
  id: `p${index}`, displayName: `Player${index}`, avatarUrl: null,
}));

export const setTimer = (ms: number, callback: () => void): (() => void) => {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};

export function fakeEngine() {
  const cards: Card[] = ["2C", "3C", "4C", "5C", "6C", "7C"];
  const engine = {
    createGame: vi.fn<Engine["createGame"]>((options) => ({
      ok: true,
      state: {
        config: options.config,
        players: options.players,
        hands: Object.fromEntries(options.players.map((player, index) => [player.id, [cards[index]!]])),
        sets: Object.fromEntries(SET_IDS.map((set) => [set, "ACTIVE"])) as GameState["sets"],
        scores: { A: 0, B: 0 }, history: [], transferCount: 0, resolutions: [],
        phase: { kind: "turn", player: options.players[0]!.id },
      },
    })),
    apply: vi.fn<Engine["apply"]>((state, action) => ({
      ok: true,
      state: { ...state, transferCount: state.transferCount + 1 },
      events: action.type === "timeout" ? [{ type: "timedOut", phase: "turn" }] : [{ type: "turnChanged", player: "p0" }],
    })),
    playerView: vi.fn<Engine["playerView"]>((state, playerId) => ({
      me: playerId,
      myTeam: state.players.find((player) => player.id === playerId)!.team,
      hand: [...state.hands[playerId]!],
      players: state.players.map((player) => ({ ...player, outOfCards: state.hands[player.id]!.length === 0 })),
      sets: state.sets, scores: state.scores, phase: state.phase,
      recentTransfers: state.history, transferCount: state.transferCount,
      resolutions: state.resolutions, config: state.config,
    })),
  } satisfies Engine;
  return engine;
}

export function roomHarness() {
  const engine = fakeEngine();
  const sent: { connId: string; msg: ServerMessage }[] = [];
  const close = vi.fn<(connId: string, reason: string) => void>();
  const finished = vi.fn();
  const connectionsChanged = vi.fn();
  const timer = vi.fn(setTimer);
  const room = new Room({
    code: "ABCD", hostId: "p0", engine, rng: () => 0.5, now: Date.now,
    setTimer: timer,
    send: (connId, msg) => sent.push({ connId, msg: structuredClone(msg) }),
    closeConnection: close, onGameFinished: finished, onConnectionsChanged: connectionsChanged,
  });
  const message = (connId: string, msg: ClientMessage) => room.handleMessage(connId, JSON.stringify(msg));
  const joinAll = () => users.forEach((user) => room.join(user.id, user));
  const assignAll = () => users.forEach((user, index) => message("p0", {
    t: "lobby.setTeam", playerId: user.id, team: index < 3 ? "A" : "B",
  }));
  const start = (timed = false) => {
    joinAll();
    assignAll();
    if (timed) message("p0", { t: "lobby.setConfig", config: { wrongDeclaration: "null", historyLimit: 5, turnSeconds: 15 } });
    message("p0", { t: "lobby.start" });
  };
  return { room, engine, sent, close, finished, connectionsChanged, timer, message, joinAll, assignAll, start };
}
