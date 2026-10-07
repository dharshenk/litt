import type { CSSProperties } from "react";
import type { Card } from "@litt/engine";
import { cardFace } from "../lib/cards.js";
import styles from "./PlayingCard.module.css";

type Size = "hand" | "mini" | "tiny" | "spot";

interface Props {
  card: Card;
  size?: Size;
  className?: string;
  style?: CSSProperties;
}

export function PlayingCard({ card, size = "hand", className, style }: Props) {
  const f = cardFace(card);
  return (
    <span
      role="img"
      aria-label={f.label}
      className={[styles.card, styles[size], className].filter(Boolean).join(" ")}
      data-red={f.red || undefined}
      style={style}
    >
      <span className={styles.rank} aria-hidden="true">
        {f.rank}
      </span>
      <span className={styles.suit} aria-hidden="true">
        {f.suit}
      </span>
      {size === "spot" && (
        <span className={`${styles.rank} ${styles.flip}`} aria-hidden="true">
          {f.rank}
        </span>
      )}
    </span>
  );
}

/** Inline card label, e.g. in transfers and the review modal. */
export function CardChip({ card, className }: { card: Card; className?: string }) {
  const f = cardFace(card);
  return (
    <span className={[styles.chip, className].filter(Boolean).join(" ")} data-red={f.red || undefined}>
      {f.label}
    </span>
  );
}
