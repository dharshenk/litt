import { useEffect, useRef, useState } from "react";
import type { Card, Team } from "@litt/engine";
import { cardLabel } from "../lib/cards.js";
import { useIsMobile } from "../lib/hooks.js";
import type { Namer } from "../game/text.js";
import { Avatar } from "../components/Avatar.js";
import { PlayingCard } from "../components/PlayingCard.js";
import styles from "./AskSpotlight.module.css";

export interface Spot {
  id: number;
  asker: string;
  target: string;
  card: Card;
  ok: boolean;
}

interface Props {
  spot: Spot | null;
  namer: Namer;
  teamOf(id: string): Team;
  /** seq of the resulting transfer, once the new view has arrived. */
  transferSeq: number | null;
  onDone(id: number): void;
}

type Stage = "enter" | "asking" | "result" | "leaving";

/** When the outcome is revealed, after the "Asking…" beat. */
export const REVEAL_MS = 1200;

/** Timeline: "Asking…" until 1.2s, then the result; fades out at 5.7s. */
export function AskSpotlight({ spot, namer, teamOf, transferSeq, onDone }: Props) {
  const [stage, setStage] = useState<Stage>("enter");
  const mobile = useIsMobile();
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!spot) return;
    setStage("enter");
    const id = spot.id;
    const timers = [
      setTimeout(() => setStage("asking"), 30),
      setTimeout(() => setStage("result"), REVEAL_MS),
      setTimeout(() => setStage("leaving"), 5650),
      setTimeout(() => done.current(id), 6100),
    ];
    return () => timers.forEach(clearTimeout);
  }, [spot?.id]);

  if (!spot) return null;
  const revealed = stage === "result" || stage === "leaving";
  const visible = stage === "asking" || stage === "result";
  const outcome = revealed ? (spot.ok ? "ok" : "bad") : "pending";
  const me = namer.me;

  const kicker = revealed ? (spot.ok ? `Transfer${transferSeq ? ` #${transferSeq}` : ""}` : "Failed ask") : "Asking…";
  const result = spot.ok
    ? `${namer.name(spot.target)} had it — ${cardLabel(spot.card)} goes to ${namer.obj(spot.asker)}`
    : `${namer.name(spot.target)} ${spot.target === me ? "don’t" : "doesn’t"} have it — ${namer.turn(spot.target)}`;

  return (
    <div className={styles.layer}>
      <div className={styles.box} data-visible={visible || undefined} data-outcome={outcome} role="status" aria-live="polite">
        <span className={styles.kicker}>{kicker}</span>
        <div className={styles.route}>
          <Person id={spot.asker} namer={namer} team={teamOf(spot.asker)} size={mobile ? 42 : 56} />
          <div className={styles.verb}>
            <span>{spot.asker === me ? "ask" : "asks"}</span>
            <span className={styles.arrow} aria-hidden="true">
              <span className={styles.shaft} />
              <span className={styles.head} />
            </span>
          </div>
          <Person id={spot.target} namer={namer} team={teamOf(spot.target)} size={mobile ? 42 : 56} />
        </div>
        <PlayingCard card={spot.card} size="spot" className={styles.card} />
        <div className={styles.result} aria-hidden={!revealed}>
          <span>{spot.ok ? "✓" : "✕"}</span>
          <span className={styles.resultText}>{result}</span>
        </div>
      </div>
    </div>
  );
}

function Person({ id, namer, team, size }: { id: string; namer: Namer; team: Team; size: number }) {
  return (
    <div className={styles.person}>
      <Avatar name={namer.raw(id)} team={team} size={size} ring />
      <span className={styles.personName}>{namer.name(id)}</span>
    </div>
  );
}
