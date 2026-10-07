import { clone } from "./clone.js";
import type { GameState, PlayerView } from "./types.js";

/**
 * The hidden-information filter: the only shape of a game that may leave the server.
 * Other players' hands and all hand sizes are omitted; only out-of-cards is public.
 */
export function playerView(state: GameState, playerId: string): PlayerView {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) throw new Error(`Unknown player: ${playerId}`);
  return {
    me: me.id,
    myTeam: me.team,
    hand: [...(state.hands[me.id] ?? [])],
    players: state.players.map((p) => ({
      id: p.id,
      team: p.team,
      outOfCards: (state.hands[p.id]?.length ?? 0) === 0,
    })),
    sets: { ...state.sets },
    scores: { A: state.scores.A, B: state.scores.B },
    phase: clone(state.phase),
    recentTransfers: state.history.map((t) => ({ seq: t.seq, from: t.from, to: t.to, card: t.card })),
    transferCount: state.transferCount,
    resolutions: state.resolutions.map((r) => ({ ...r })),
    config: {
      wrongDeclaration: state.config.wrongDeclaration,
      historyLimit: state.config.historyLimit,
    },
  };
}
