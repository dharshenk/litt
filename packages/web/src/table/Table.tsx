import { useEffect, useRef, useState, type ReactNode } from "react";
import { getRecentAsks, type Assignment, type Card, type PlayerView, type SetId, type Team } from "@litt/engine";
import type { ClientMessage, RoomSnapshot } from "@litt/protocol";
import { useIsMobile, useFocusTrap, usePrevious } from "../lib/hooks.js";
import { playSound } from "../lib/sound.js";
import {
  askTargets,
  askableCards,
  askableSets,
  canIChoose,
  declarableSets,
  effectiveAssignment,
  isMyTurn,
} from "../game/legal.js";
import type { Namer } from "../game/text.js";
import { ToastViewport } from "../components/Toasts.js";
import { Header } from "./Header.js";
import { PlayerRow, SetsPanel } from "./Board.js";
import { Hand } from "./Hand.js";
import { ActionPanel, Transactions } from "./Panel.js";
import { ReviewModal } from "./ReviewModal.js";
import { AskSpotlight, type Spot } from "./AskSpotlight.js";
import styles from "./Table.module.css";

export type TableTab = "ask" | "declare";

export interface TableUi {
  tab: TableTab;
  askSet: SetId | null;
  askCard: Card | null;
  askTarget: string | null;
  declSet: SetId | null;
  picks: Assignment;
  review: boolean;
}

const freshUi = (tab: TableTab = "ask"): TableUi => ({
  tab,
  askSet: null,
  askCard: null,
  askTarget: null,
  declSet: null,
  picks: {},
  review: false,
});

/** The current, still-legal selections derived from local UI state. */
export interface Selection {
  askSets: SetId[];
  askSet: SetId | null;
  askCards: Card[];
  askCard: Card | null;
  targets: string[];
  askTarget: string | null;
  declSets: SetId[];
  declSet: SetId | null;
}

function select(view: PlayerView, ui: TableUi): Selection {
  const askSets = askableSets(view);
  const askSet = ui.askSet && askSets.includes(ui.askSet) ? ui.askSet : null;
  const askCards = askSet ? askableCards(view, askSet) : [];
  const askCard = ui.askCard && askCards.includes(ui.askCard) ? ui.askCard : null;
  const targets = askTargets(view);
  const askTarget = ui.askTarget && targets.includes(ui.askTarget) ? ui.askTarget : null;
  const declSets = declarableSets(view);
  const declSet = ui.declSet && declSets.includes(ui.declSet) ? ui.declSet : null;
  return { askSets, askSet, askCards, askCard, targets, askTarget, declSets, declSet };
}

interface Props {
  room: RoomSnapshot;
  view: PlayerView;
  deadline: number | null;
  namer: Namer;
  send(msg: ClientMessage): void;
  spot: Spot | null;
  onSpotDone(id: number): void;
  /** Changes on navigation; resets local UI (used by mock scenarios). */
  uiKey: string;
  initialTab?: TableTab;
  /** Changes when the server rejects an action. */
  errorId: number;
}

export function Table({ room, view, deadline, namer, send, spot, onSpotDone, uiKey, initialTab, errorId }: Props) {
  const mobile = useIsMobile();
  const myTurn = isMyTurn(view);
  const iChoose = canIChoose(view);
  const [ui, setUi] = useState<TableUi>(() => freshUi(initialTab));
  const [sheet, setSheet] = useState(false);
  const [setsOpen, setSetsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const sel = select(view, ui);

  // A new view or an error means the server answered; allow the next action.
  useEffect(() => setPending(false), [view, errorId]);

  // Fresh selections whenever my turn starts.
  const wasMyTurn = usePrevious(myTurn);
  useEffect(() => {
    if (myTurn && wasMyTurn === false) setUi(freshUi(initialTab));
    if (!myTurn) setUi((u) => (u.review ? { ...u, review: false } : u));
  }, [myTurn]);

  // Mock scenarios navigate to preset the tab.
  const firstKey = useRef(uiKey);
  useEffect(() => {
    if (uiKey === firstKey.current) return;
    firstKey.current = uiKey;
    setUi(freshUi(initialTab));
    setSheet(false);
    setSetsOpen(false);
  }, [uiKey]);

  // Phones: the sheet opens for the chooser, and closes when there's nothing to do.
  useEffect(() => {
    if (iChoose) setSheet(true);
    else if (!myTurn) setSheet(false);
  }, [iChoose, myTurn]);

  // Deal sound for a brand-new game.
  const isNewGame = view.transferCount === 0 && view.resolutions.length === 0;
  const dealt = useRef(false);
  useEffect(() => {
    if (isNewGame && !dealt.current) playSound("deal");
    dealt.current = true;
  }, []);

  const patch = (p: Partial<TableUi>) => setUi((u) => ({ ...u, ...p }));

  const ask = () => {
    if (pending || !sel.askCard || !sel.askTarget) return;
    send({ t: "game.ask", target: sel.askTarget, card: sel.askCard });
    setPending(true);
    setSheet(false);
  };

  const declare = () => {
    if (pending || !sel.declSet) return;
    send({ t: "game.declare", set: sel.declSet, assignment: effectiveAssignment(view, sel.declSet, ui.picks) });
    setPending(true);
    setUi((u) => ({ ...u, review: false }));
    setSheet(false);
  };

  const choose = (player: string) => {
    if (pending) return;
    send({ t: "game.choose", player });
    setPending(true);
  };

  const teamOf = (id: string): Team => view.players.find((p) => p.id === id)?.team ?? "A";
  const other: Team = view.myTeam === "A" ? "B" : "A";
  const focusSet = myTurn ? (ui.tab === "ask" ? sel.askSet : sel.declSet) : null;
  const askingTarget = myTurn && ui.tab === "ask" ? sel.askTarget : null;

  // The newest transfer gets a "Now" tag while its spotlight is up.
  const spotSeq = spot?.ok
    ? ([...view.recentTransfers].reverse().find((t) => t.card === spot.card && t.to === spot.asker && t.from === spot.target)
        ?.seq ?? null)
    : null;
  const attempts = getRecentAsks(view);
  const nowAskSeq = spot
    ? ([...attempts].reverse().find((attempt) =>
        attempt.card === spot.card && attempt.asker === spot.asker && attempt.target === spot.target && attempt.ok === spot.ok,
      )?.seq ?? null)
    : null;

  const panel = (
    <ActionPanel
      view={view}
      ui={ui}
      sel={sel}
      namer={namer}
      pending={pending}
      patch={patch}
      onAsk={ask}
      onReview={() => patch({ review: true })}
      onChoose={choose}
    />
  );

  const sheetVisible = mobile && sheet && (myTurn || iChoose);

  return (
    <div className={styles.table}>
      <Header room={room} view={view} deadline={deadline} namer={namer} mobile={mobile} />
      <div className={styles.body}>
        <main className={styles.main}>
          <div className={styles.tableTools}>
            <button
              type="button"
              className={styles.setsButton}
              aria-haspopup="dialog"
              aria-expanded={setsOpen}
              onClick={() => setSetsOpen(true)}
            >
              Sets
            </button>
          </div>
          <PlayerRow
            label={`Opponents · Team ${other}`}
            team={other}
            view={view}
            room={room}
            namer={namer}
            mobile={mobile}
            askingTarget={askingTarget}
          />
          <PlayerRow
            label={`Your team · Team ${view.myTeam}`}
            team={view.myTeam}
            view={view}
            room={room}
            namer={namer}
            mobile={mobile}
            askingTarget={null}
          />
          {mobile && (
            <Transactions
              attempts={attempts}
              limit={view.config.historyLimit}
              namer={namer}
              nowSeq={nowAskSeq}
              inline
            />
          )}
          <Hand hand={view.hand} focusSet={focusSet} deal={isNewGame} />
        </main>
        {!mobile && (
          <aside className={styles.aside} aria-label="Actions">
            <div className={styles.panel}>{panel}</div>
            <Transactions attempts={attempts} limit={view.config.historyLimit} namer={namer} nowSeq={nowAskSeq} />
          </aside>
        )}
      </div>

      {mobile && (
        <BottomBar
          view={view}
          namer={namer}
          myTurn={myTurn}
          iChoose={iChoose}
          onOpen={(tab) => {
            if (tab) patch({ tab });
            setSheet(true);
          }}
        />
      )}
      {sheetVisible && <Sheet onClose={() => setSheet(false)}>{panel}</Sheet>}
      {setsOpen && <SetsModal view={view} onClose={() => setSetsOpen(false)} />}

      <AskSpotlight spot={spot} namer={namer} teamOf={teamOf} transferSeq={spotSeq} onDone={onSpotDone} />
      <ToastViewport placement="game" />
      {myTurn && ui.review && sel.declSet && (
        <ReviewModal
          view={view}
          set={sel.declSet}
          assignment={effectiveAssignment(view, sel.declSet, ui.picks)}
          namer={namer}
          pending={pending}
          onBack={() => patch({ review: false })}
          onConfirm={declare}
        />
      )}
    </div>
  );
}

function SetsModal({ view, onClose }: { view: PlayerView; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  return (
    <div className={styles.setsScrim} onClick={onClose}>
      <div
        ref={ref}
        className={styles.setsDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sets-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.setsDialogHead}>
          <h2 id="sets-title">Sets</h2>
          <button type="button" className={styles.setsButton} onClick={onClose}>Close</button>
        </div>
        <SetsPanel sets={view.sets} />
      </div>
    </div>
  );
}

function BottomBar({
  view,
  namer,
  myTurn,
  iChoose,
  onOpen,
}: {
  view: PlayerView;
  namer: Namer;
  myTurn: boolean;
  iChoose: boolean;
  onOpen(tab?: TableTab): void;
}) {
  const { phase } = view;
  let idle = "";
  if (phase.kind === "over") idle = "Game over";
  else if (phase.kind === "choose") {
    const who = "player" in phase.chooser ? namer.name(phase.chooser.player) : `Team ${phase.chooser.team}`;
    idle = `${who} is picking who plays next`;
  } else if (phase.kind === "turn") idle = `${namer.turn(phase.player)} — watch the table`;

  return (
    <div className={styles.bottomBar}>
      {myTurn ? (
        <div className={styles.bottomPair}>
          <button type="button" className={styles.bottomPrimary} onClick={() => onOpen("ask")}>
            Ask
          </button>
          <button type="button" className={styles.bottomSecondary} onClick={() => onOpen("declare")}>
            Declare
          </button>
        </div>
      ) : iChoose ? (
        <button type="button" className={styles.bottomPrimary} onClick={() => onOpen()}>
          Pick who plays next
        </button>
      ) : (
        <div className={styles.bottomIdle}>{idle}</div>
      )}
    </div>
  );
}

function Sheet({ onClose, children }: { onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose, true);
  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div ref={ref} className={styles.sheet} role="dialog" aria-modal="true" aria-label="Actions" tabIndex={-1}>
        <div className={styles.handle}>
          <button type="button" className={styles.handleBtn} aria-label="Close" onClick={onClose}>
            <span />
          </button>
        </div>
        <div className={styles.sheetPanel}>{children}</div>
      </div>
    </>
  );
}
