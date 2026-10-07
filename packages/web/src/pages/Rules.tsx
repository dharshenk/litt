import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Card } from "@litt/engine";
import { Logo } from "../components/Misc.js";
import { PlayingCard } from "../components/PlayingCard.js";
import styles from "./Rules.module.css";

const FACTS = [
  { n: "54", label: "cards", note: "52 + 2 Jokers, all dealt" },
  { n: "9", label: "sets", note: "6 cards each" },
  { n: "2", label: "teams", note: "equal size" },
  { n: "6+", label: "players", note: "an even number" },
];

const SETS: { name: string; range: string; cards: Card[]; red?: boolean }[] = [
  { name: "Low ♣", range: "2–7", cards: ["2C", "3C", "4C"] },
  { name: "Low ♦", range: "2–7", cards: ["2D", "3D", "4D"] },
  { name: "Low ♥", range: "2–7", cards: ["2H", "3H", "4H"] },
  { name: "Low ♠", range: "2–7", cards: ["2S", "3S", "4S"] },
  { name: "High ♣", range: "9–A", cards: ["QC", "KC", "AC"] },
  { name: "High ♦", range: "9–A", cards: ["QD", "KD", "AD"] },
  { name: "High ♥", range: "9–A", cards: ["QH", "KH", "AH"] },
  { name: "High ♠", range: "9–A", cards: ["QS", "KS", "AS"] },
  { name: "8s & Jokers", range: "8♣ 8♦ 8♥ 8♠ ★ ★", cards: ["8H", "JK1", "JK2"] },
];

const ASK_RULES = [
  ["Ask an opponent", "Never a teammate."],
  ["Not a card you hold", "Asking for your own card is out."],
  ["Hold a base card", "You must personally hold at least one card from that set."],
  ["Your hand only", "A teammate holding the set doesn’t count."],
];

const TRANSFERS = [
  "Alice → Bob · 5♥",
  "David → Charlie · K♠",
  "Bob → David · 3♦",
  "Charlie → Alice · 7♣",
  "Eve → Frank · 9♠",
  "Frank → Bob · JK",
];

export function Rules() {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link to="/" className={styles.logo} aria-label="Back to home">
          <Logo size={24} />
        </Link>
        <Link to="/" className={styles.back}>
          ← Back
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.fan} aria-hidden="true">
            <PlayingCard card="3H" size="spot" className={styles.f1} />
            <PlayingCard card="5H" size="spot" className={styles.f2} />
            <PlayingCard card="7H" size="spot" className={styles.f3} />
          </div>
          <h1 className={styles.title}>
            How to <em>play</em>
          </h1>
          <p className={styles.lede}>Ask for cards. Remember who has what. Declare sets before the other team does.</p>
        </section>

        <ul className={styles.facts}>
          {FACTS.map((f, i) => (
            <li key={f.label} className={styles.fact} style={{ animationDelay: `${i * 80}ms` }}>
              <span className={styles.big}>{f.n}</span>
              <span className={styles.factLabel}>{f.label}</span>
              <span className={styles.factNote}>{f.note}</span>
            </li>
          ))}
        </ul>

        <Section n="1" title="The nine sets" blurb="Cards are grouped into six-card sets. Win more sets than the other team.">
          <ul className={styles.sets}>
            {SETS.map((s) => (
              <li key={s.name} className={styles.set}>
                <div className={styles.setCards} aria-hidden="true">
                  {s.cards.map((c) => (
                    <PlayingCard key={c} card={c} size="tiny" />
                  ))}
                </div>
                <span className={styles.setName}>{s.name}</span>
                <span className={styles.setRange}>{s.range}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section n="2" title="Deal" blurb="The whole deck is dealt as evenly as possible. No draw pile. With 8 players, six get 7 cards and two get 6." />

        <Section n="3" title="Your turn" blurb="Ask one opponent for one specific card.">
          <div className={styles.demos}>
            <Demo kind="hit" />
            <Demo kind="miss" />
          </div>
        </Section>

        <Section n="4" title="What you may ask for" blurb="A request is legal only if all of these hold.">
          <ol className={styles.rules}>
            {ASK_RULES.map(([h, p], i) => (
              <li key={h} className={styles.rule}>
                <span className={styles.ruleN}>{i + 1}</span>
                <div>
                  <strong>{h}</strong>
                  <span>{p}</span>
                </div>
              </li>
            ))}
          </ol>
          <p className={styles.example}>
            Holding <em>3♥</em> lets you ask for 2♥, 4♥, 5♥, 6♥ or 7♥ — but never K♠.
          </p>
        </Section>

        <Section n="5" title="Declare a set" blurb="On your turn, claim that your team holds all six cards of a set.">
          <div className={styles.declare}>
            <div className={styles.decl} data-team="A">
              <span className={styles.declHead}>You must name the exact holder of every card</span>
              <div className={styles.declRows}>
                {[
                  ["Alice", "2♥ 5♥"],
                  ["Charlie", "3♥ 4♥"],
                  ["Eve", "6♥ 7♥"],
                ].map(([who, cards], i) => (
                  <div key={who} className={styles.declRow} style={{ animationDelay: `${i * 0.5}s` }}>
                    <span>{who}</span>
                    <span className={styles.declCards}>{cards}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.outcomes}>
              <div className={styles.outcome} data-ok>
                <strong>Correct</strong>
                <span>Your team scores 1. The set leaves play and you pass the turn to a teammate.</span>
              </div>
              <div className={styles.outcome}>
                <strong>Wrong</strong>
                <span>Chosen before the game starts:</span>
                <ul>
                  <li>
                    <b>Opponent award</b> — the other team gets the set.
                  </li>
                  <li>
                    <b>Null set</b> — nobody scores, so draws are possible.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </Section>

        <Section n="6" title="Memory" blurb="Remember as much as you like. Only the last three successful transfers can be checked formally.">
          <History />
        </Section>

        <Section n="7" title="Winning" blurb="The game ends when all nine sets are resolved. Most sets wins; equal is a draw.">
          <div className={styles.score} aria-label="Example: Team A 5, Team B 4">
            <span className={styles.teamA}>
              Team A <b>5</b>
            </span>
            <span className={styles.bar} aria-hidden="true">
              <i style={{ flex: 5 }} data-team="A" />
              <i style={{ flex: 4 }} data-team="B" />
            </span>
            <span className={styles.teamB}>
              <b>4</b> Team B
            </span>
          </div>
        </Section>

        <footer className={styles.foot}>
          <Link to="/" className={styles.cta}>
            Let’s play
          </Link>
        </footer>
      </main>
    </div>
  );
}

function Section({ n, title, blurb, children }: { n: string; title: string; blurb: string; children?: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.head}>
        <span className={styles.num}>{n}</span>
        <div>
          <h2 className={styles.h2}>{title}</h2>
          <p className={styles.blurb}>{blurb}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** Looping mini-animation: a hit moves the card and keeps the turn; a miss passes the turn. */
function Demo({ kind }: { kind: "hit" | "miss" }) {
  const hit = kind === "hit";
  return (
    <figure className={styles.demo} data-kind={kind}>
      <div className={styles.stage} aria-hidden="true">
        <div className={styles.seat} data-team="A">
          <span className={styles.avatar}>A</span>
          <span>Alice</span>
        </div>
        <div className={styles.lane}>
          <span className={styles.ask}>5♥?</span>
          {hit && <PlayingCard card="5H" size="tiny" className={styles.flyer} />}
        </div>
        <div className={styles.seat} data-team="B">
          <span className={styles.avatar}>B</span>
          <span>Bob</span>
        </div>
        <span className={styles.turn} />
      </div>
      <figcaption className={styles.cap}>
        <strong>{hit ? "Hit" : "Miss"}</strong>
        {hit ? "Bob hands it over. Alice asks again." : "Bob doesn’t have it. Bob’s turn."}
      </figcaption>
    </figure>
  );
}

function History() {
  const [tick, setTick] = useState(2);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(id);
  }, []);
  const shown = [tick - 2, tick - 1, tick].map((i) => ({ i, text: TRANSFERS[i % TRANSFERS.length]! }));
  return (
    <div className={styles.history} aria-hidden="true">
      {shown.map(({ i, text }, k) => (
        <div key={i} className={styles.tx} data-age={2 - k}>
          <span className={styles.txN}>#{i + 21}</span>
          {text}
        </div>
      ))}
      <span className={styles.histNote}>Older transfers drop off — but you can still use what you remember.</span>
    </div>
  );
}
