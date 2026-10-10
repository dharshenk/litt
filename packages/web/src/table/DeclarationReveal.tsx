import { useId, useRef } from "react";
import { cardsInSet, type Team } from "@litt/engine";
import { setInfo } from "../lib/cards.js";
import { useFocusTrap } from "../lib/hooks.js";
import { declarationResult, type DeclaredEvent, type Namer } from "../game/text.js";
import { Avatar } from "../components/Avatar.js";
import { CardChip } from "../components/PlayingCard.js";
import styles from "./DeclarationReveal.module.css";

interface Props {
  /** A wrong declaration: shows where each card of the set really was. */
  event: DeclaredEvent;
  namer: Namer;
  teamOf(id: string): Team | null;
  onClose(): void;
}

export function DeclarationReveal({ event, namer, teamOf, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  const id = useId();
  const rows = cardsInSet(event.set).flatMap((card) => {
    const holder = event.holders[card];
    return holder ? [{ card, holder, claimed: event.assignment[card], wrong: event.assignment[card] !== holder }] : [];
  });

  return (
    <div className={styles.scrim}>
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-kicker ${id}-title`}
      >
        <div className={styles.head}>
          <span id={`${id}-kicker`} className={styles.kicker}>
            Wrong declaration
          </span>
          <h2 id={`${id}-title`} className={styles.title}>
            {setInfo(event.set).full}
          </h2>
          <p className={styles.summary}>
            Declared by {namer.obj(event.player)}. {declarationResult(event)}
          </p>
        </div>
        <div className={styles.cards}>
          <p id={`${id}-caption`} className={styles.caption}>
            Who held each card
          </p>
          <ul className={styles.rows} aria-labelledby={`${id}-caption`}>
            {rows.map(({ card, holder, claimed, wrong }) => (
              <li key={card} className={styles.row} data-wrong={wrong || undefined}>
                <CardChip card={card} className={styles.chip} />
                <span className={styles.who}>
                  <Avatar name={namer.raw(holder)} team={teamOf(holder)} size={26} />
                  <span className={styles.name}>{namer.name(holder)}</span>
                </span>
                <span className={styles.verdict} aria-hidden="true">
                  {wrong ? "✕" : "✓"}
                </span>
                <span className="sr-only">{wrong ? "Wrong." : "Correct."}</span>
                {wrong && claimed && <span className={styles.claim}>Declared as {namer.obj(claimed)}</span>}
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className={styles.close} onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
