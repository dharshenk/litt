import { useRef } from "react";
import { cardsInSet, type Assignment, type PlayerView, type SetId } from "@litt/engine";
import { setInfo } from "../lib/cards.js";
import { useFocusTrap } from "../lib/hooks.js";
import { teammates } from "../game/legal.js";
import type { Namer } from "../game/text.js";
import { CardChip } from "../components/PlayingCard.js";
import styles from "./ReviewModal.module.css";

interface Props {
  view: PlayerView;
  set: SetId;
  assignment: Assignment;
  namer: Namer;
  pending: boolean;
  onBack(): void;
  onConfirm(): void;
}

export function ReviewModal({ view, set, assignment, namer, pending, onBack, onConfirm }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onBack);
  const title = setInfo(set).full;
  const groups = teammates(view)
    .map((p) => ({ id: p.id, cards: cardsInSet(set).filter((c) => assignment[c] === p.id) }))
    .filter((g) => g.cards.length > 0);
  const warn =
    view.config.wrongDeclaration === "award"
      ? "A wrong declaration gives the set to the other team."
      : "A wrong declaration nullifies the set.";

  return (
    <div className={styles.scrim} onClick={onBack}>
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <span className={styles.kicker}>Review declaration</span>
          <h2 id="review-title" className={styles.title}>
            {title}
          </h2>
        </div>
        <div className={styles.groups}>
          {groups.map((g) => (
            <div key={g.id} className={styles.group}>
              <span className={styles.name}>{namer.name(g.id)}</span>
              <div className={styles.cards}>
                {g.cards.map((c) => (
                  <CardChip key={c} card={c} className={styles.chip} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className={styles.warn}>This cannot be undone. {warn}</p>
        <div className={styles.buttons}>
          <button type="button" className={styles.back} onClick={onBack}>
            Back
          </button>
          <button type="button" className={styles.confirm} onClick={onConfirm} disabled={pending}>
            Declare set
          </button>
        </div>
      </div>
    </div>
  );
}
