import { useEffect, useRef } from "react";
import { SET_IDS, setOf, type Card, type SetId } from "@litt/engine";
import { setInfo } from "../lib/cards.js";
import { PlayingCard } from "../components/PlayingCard.js";
import styles from "./Hand.module.css";

interface Props {
  hand: Card[];
  /** The set being asked about or declared; its group lifts. */
  focusSet: SetId | null;
  /** Play the deal animation for the cards present when the hand first renders. */
  deal: boolean;
}

type Anim = "deal" | "received" | "none";

export function Hand({ hand, focusSet, deal }: Props) {
  // Each card keeps the animation it was given when it entered the hand,
  // so re-renders don't cut a running animation short.
  const anims = useRef(new Map<Card, Anim>());
  const mounted = useRef(false);
  for (const card of hand) {
    if (!anims.current.has(card)) anims.current.set(card, mounted.current ? "received" : deal ? "deal" : "none");
  }
  for (const card of [...anims.current.keys()]) {
    if (!hand.includes(card)) anims.current.delete(card);
  }
  useEffect(() => {
    mounted.current = true;
  }, []);

  const groups = SET_IDS.map((set) => ({ set, cards: hand.filter((c) => setOf(c) === set) })).filter(
    (g) => g.cards.length > 0,
  );

  return (
    <section className={styles.hand} aria-label="Your hand">
      <span className="label">Your hand</span>
      {hand.length === 0 ? (
        <div className={styles.empty}>You are out of cards. Your team plays on.</div>
      ) : (
        <div className={styles.groups}>
          {groups.map((g) => {
            const info = setInfo(g.set);
            const lifted = focusSet === g.set;
            return (
              <div key={g.set} className={styles.group} role="group" aria-label={info.full} data-lifted={lifted || undefined}>
                <div className={styles.groupHead}>
                  <span className={styles.groupLabel}>{info.full}</span>
                  <span className={styles.groupCount} aria-label={`${g.cards.length} of 6 held`}>{g.cards.length} / 6</span>
                </div>
                <div className={styles.cards}>
                  {g.cards.map((card, i) => {
                    const anim = anims.current.get(card) ?? "none";
                    return (
                      <PlayingCard
                        key={card}
                        card={card}
                        className={`${styles.card} ${anim === "none" ? "" : styles[anim]}`}
                        style={anim === "deal" ? { animationDelay: `${i * 40}ms` } : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
