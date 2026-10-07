import { useId } from "react";
import { cardsInSet, type AskAttempt, type Card, type PlayerView, type SetId } from "@litt/engine";
import { cardLabel, setInfo } from "../lib/cards.js";
import {
  assignableTeammates,
  canIChoose,
  effectiveAssignment,
  isMyTurn,
  opponents,
  teammates,
  unassignedCount,
} from "../game/legal.js";
import type { Namer } from "../game/text.js";
import { Avatar } from "../components/Avatar.js";
import { CardChip, PlayingCard } from "../components/PlayingCard.js";
import { Chips, Segmented } from "../components/Choice.js";
import type { Selection, TableTab, TableUi } from "./Table.js";
import styles from "./Panel.module.css";

interface PanelProps {
  view: PlayerView;
  ui: TableUi;
  sel: Selection;
  namer: Namer;
  pending: boolean;
  patch(p: Partial<TableUi>): void;
  onAsk(): void;
  onReview(): void;
  onChoose(player: string): void;
}

export function ActionPanel(props: PanelProps) {
  const { view, namer } = props;
  const { phase } = view;

  if (isMyTurn(view)) {
    return (
      <>
        <Segmented<TableTab>
          label="Action"
          value={props.ui.tab}
          onChange={(tab) => props.patch({ tab })}
          options={[
            { value: "ask", label: "Ask" },
            { value: "declare", label: "Declare" },
          ]}
        />
        {props.ui.tab === "ask" ? <AskPanel {...props} /> : <DeclarePanel {...props} />}
      </>
    );
  }

  if (canIChoose(view) && phase.kind === "choose") {
    const kicker =
      phase.reason === "correctDeclaration"
        ? "You declared correctly"
        : phase.reason === "opponentsEmpty"
          ? "Your team keeps the turn"
          : "Your team gets the turn";
    return (
      <>
        <div className={styles.titleBlock}>
          <span className={styles.kicker}>{kicker}</span>
          <h2 className={styles.title}>Pick who plays next</h2>
        </div>
        <div className={styles.chooseList}>
          {phase.eligible.map((id) => {
            const p = view.players.find((x) => x.id === id);
            return (
              <button
                key={id}
                type="button"
                className={styles.chooseItem}
                disabled={props.pending}
                onClick={() => props.onChoose(id)}
              >
                <Avatar name={namer.raw(id)} team={p?.team ?? null} size={34} />
                <span className={styles.chooseName}>{namer.name(id)}</span>
                <span className={styles.play}>Play →</span>
              </button>
            );
          })}
        </div>
      </>
    );
  }

  if (phase.kind === "choose") {
    const { chooser } = phase;
    const chooserTeam = "player" in chooser ? view.players.find((p) => p.id === chooser.player)?.team : chooser.team;
    const who = "player" in chooser ? namer.raw(chooser.player) : `Team ${chooser.team}`;
    return (
      <div className={styles.center}>
        <span className={`spinner ${styles.waitSpin}`} data-team={chooserTeam} />
        <span className={styles.waitText}>Waiting for {who} to pick who plays next</span>
      </div>
    );
  }

  if (phase.kind === "turn") {
    const p = view.players.find((x) => x.id === phase.player);
    const mate = p?.team === view.myTeam;
    return (
      <div className={styles.center}>
        <span className={styles.otherAvatar} data-team={p?.team}>
          <Avatar name={namer.raw(phase.player)} team={p?.team ?? null} size={60} ring />
        </span>
        <div className={styles.otherText}>
          <span className={styles.otherTitle}>{namer.turn(phase.player)}</span>
          <span className={styles.otherSub}>
            {mate
              ? "Your teammate is asking. Watch the transfers."
              : "Watch who asks for what — every ask shows a set they hold."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.center}>
      <span className={styles.otherTitle}>Game over</span>
    </div>
  );
}

function AskPanel({ view, sel, namer, pending, patch, onAsk }: PanelProps) {
  const cardGroup = useId();
  const targetGroup = useId();
  const opps = opponents(view);
  const ready = !!sel.askCard && !!sel.askTarget;
  const label = ready
    ? `Ask ${namer.raw(sel.askTarget!)} for ${cardLabel(sel.askCard!)}`
    : !sel.askSet
      ? "Pick a set"
      : !sel.askCard
        ? "Pick a card"
        : "Pick an opponent";

  return (
    <>
      <div className={styles.step}>
        <span className={styles.stepLabel}>1 · Pick a set you hold</span>
        {sel.askSets.length > 0 ? (
          <Chips<SetId>
            label="Set to ask from"
            value={sel.askSet}
            onChange={(askSet) => patch({ askSet, askCard: null })}
            options={sel.askSets.map((s) => ({ value: s, label: setInfo(s).name }))}
          />
        ) : (
          <span className={styles.hint}>You hold every card of your sets. Declare one instead.</span>
        )}
      </div>
      {sel.askSet && sel.targets.length > 0 && (
        <>
          <div className={`${styles.step} ${styles.fadeIn}`}>
            <span className={styles.stepLabel} id={cardGroup}>
              2 · Pick a card you don’t have
            </span>
            <div role="radiogroup" aria-labelledby={cardGroup} className={styles.askCards}>
              {sel.askCards.map((c) => (
                <label key={c} className={styles.askCard} data-on={sel.askCard === c || undefined}>
                  <input
                    type="radio"
                    className="sr-only"
                    name={cardGroup}
                    checked={sel.askCard === c}
                    onChange={() => patch({ askCard: c })}
                  />
                  <PlayingCard card={c} size="mini" />
                </label>
              ))}
            </div>
          </div>
          <div className={styles.step}>
            <span className={styles.stepLabel} id={targetGroup}>
              3 · Pick an opponent
            </span>
            <div role="radiogroup" aria-labelledby={targetGroup} className={styles.targets}>
              {opps.map((p) => {
                const on = sel.askTarget === p.id;
                return (
                  <label
                    key={p.id}
                    className={styles.target}
                    data-on={on || undefined}
                    data-out={p.outOfCards || undefined}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name={targetGroup}
                      checked={on}
                      disabled={p.outOfCards}
                      onChange={() => patch({ askTarget: p.id })}
                    />
                    <span className={styles.radio} aria-hidden="true" />
                    <span className={styles.targetName}>{namer.raw(p.id)}</span>
                    <span className={styles.targetTag}>{p.outOfCards ? "Out of cards" : ""}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}
      {sel.targets.length === 0 && (
        <span className={styles.hint}>Every opponent is out of cards. Declare a set instead.</span>
      )}
      <button type="button" className={styles.cta} disabled={!ready || pending} onClick={onAsk}>
        {label}
      </button>
    </>
  );
}

function DeclarePanel({ view, ui, sel, namer, pending, patch, onReview }: PanelProps) {
  const mates = teammates(view);
  const assignable = new Set(assignableTeammates(view));
  const set = sel.declSet;
  const assignment = set ? effectiveAssignment(view, set, ui.picks) : {};
  const missing = set ? unassignedCount(view, set, ui.picks) : 0;
  const ready = !!set && missing === 0;
  const label = !set ? "Pick a set" : ready ? "Review declaration" : `Assign ${missing} more`;

  return (
    <>
      <div className={styles.step}>
        <span className={styles.stepLabel}>1 · Pick a set you hold</span>
        {sel.declSets.length > 0 ? (
          <Chips<SetId>
            label="Set to declare"
            value={set}
            onChange={(declSet) => patch({ declSet, picks: {} })}
            options={sel.declSets.map((s) => ({ value: s, label: setInfo(s).name }))}
          />
        ) : (
          <span className={styles.hint}>You need at least one card from a set to declare it.</span>
        )}
      </div>
      {set && (
        <div className={`${styles.step} ${styles.fadeIn}`}>
          <span className={styles.stepLabel}>2 · Who holds each card?</span>
          <div className={styles.declRows}>
            {cardsInSet(set).map((card: Card) => {
              const mine = view.hand.includes(card);
              return (
                <div key={card} className={styles.declRow}>
                  <PlayingCard card={card} size="tiny" />
                  <Segmented<string>
                    label={`Who holds ${cardLabel(card)}${mine ? " (yours)" : ""}`}
                    compact
                    columns={Math.min(mates.length, 3)}
                    value={assignment[card] ?? null}
                    disabled={mine}
                    onChange={(who) => patch({ picks: { ...ui.picks, [card]: who } })}
                    options={mates.map((m) => ({
                      value: m.id,
                      label: namer.name(m.id),
                      disabled: !assignable.has(m.id),
                      title: assignable.has(m.id) ? undefined : "Out of cards",
                    }))}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <button type="button" className={styles.cta} disabled={!ready || pending} onClick={onReview}>
        {label}
      </button>
    </>
  );
}

interface TransactionsProps {
  attempts: AskAttempt[];
  limit: number;
  namer: Namer;
  /** seq of the transfer currently in the spotlight. */
  nowSeq: number | null;
  /** Phones: compact block above the hand. */
  inline?: boolean;
}

export function Transactions({ attempts, limit, namer, nowSeq, inline }: TransactionsProps) {
  const rows = [...attempts].sort((first, second) => second.seq - first.seq).slice(0, limit);
  return (
    <section className={inline ? styles.transfersInline : styles.transfers} aria-label="Recent transactions">
      <div className={styles.transfersHead}>
        <span className="label">Recent transactions</span>
        <span className={styles.transfersMeta}>last {limit}</span>
      </div>
      {rows.length === 0 && <span className={styles.noTransfers}>No transactions yet.</span>}
      <ol className={styles.transferList}>
        {rows.map((attempt, index) => {
          const now = attempt.seq === nowSeq && index === 0;
          return (
            <li key={attempt.seq} className={styles.transfer} data-now={now || undefined} data-ok={attempt.ok}>
              {!inline && <span className={styles.seq}>#{attempt.seq}</span>}
              <span className={styles.route}>
                {namer.name(attempt.ok ? attempt.target : attempt.asker)} <span className={styles.arrow}>→</span>{" "}
                {namer.name(attempt.ok ? attempt.asker : attempt.target)}
              </span>
              {now && !inline && <span className={styles.nowTag}>Now</span>}
              <CardChip card={attempt.card} />
              <span className={styles.outcome}>{attempt.ok ? "Received" : "Failed"}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
