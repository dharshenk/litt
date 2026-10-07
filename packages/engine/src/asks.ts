import type { Card } from "./cards.js";
import type { GameState, PlayerView, Transfer } from "./types.js";

export interface AskAttempt {
  seq: number;
  asker: string;
  target: string;
  card: Card;
  ok: boolean;
}

type StateWithAsks = GameState & { askHistory?: AskAttempt[] };
export type ViewWithAsks = PlayerView & { recentAsks: AskAttempt[] };

function fromTransfers(transfers: Transfer[]): AskAttempt[] {
  return transfers.map((transfer) => ({
    seq: transfer.seq,
    asker: transfer.to,
    target: transfer.from,
    card: transfer.card,
    ok: true,
  }));
}

export function getAskHistory(state: GameState): AskAttempt[] {
  return (state as StateWithAsks).askHistory ?? fromTransfers(state.history);
}

export function getRecentAsks(view: PlayerView): AskAttempt[] {
  return (view as Partial<ViewWithAsks>).recentAsks ?? fromTransfers(view.recentTransfers);
}

export function recordAsk(state: GameState, attempt: Omit<AskAttempt, "seq">): void {
  const history = getAskHistory(state);
  const seq = (history.at(-1)?.seq ?? 0) + 1;
  (state as StateWithAsks).askHistory = [...history, { seq, ...attempt }].slice(-state.config.historyLimit);
}
