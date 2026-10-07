import { useEffect, useRef } from "react";
import type { PlayerView, Team } from "@litt/engine";
import type { RoomSnapshot } from "@litt/protocol";
import { useNow } from "../lib/hooks.js";
import { playSound, setMuted, useMuted } from "../lib/sound.js";
import { canIChoose, isMyTurn } from "../game/legal.js";
import type { Namer } from "../game/text.js";
import styles from "./Table.module.css";

interface Props {
  room: RoomSnapshot;
  view: PlayerView;
  deadline: number | null;
  namer: Namer;
  mobile: boolean;
}

export function Header({ room, view, deadline, namer, mobile }: Props) {
  const muted = useMuted();
  const { phase } = view;
  const myTurn = isMyTurn(view);
  const iChoose = canIChoose(view);
  const teamOf = (id: string): Team | undefined => view.players.find((p) => p.id === id)?.team;

  let text = "Game over";
  let team: Team | undefined;
  let mine = false;
  if (myTurn) {
    text = "Your turn";
    mine = true;
  } else if (iChoose) {
    text = "You pick next";
    mine = true;
  } else if (phase.kind === "choose") {
    if ("player" in phase.chooser) {
      text = `${namer.raw(phase.chooser.player)} is choosing`;
      team = teamOf(phase.chooser.player);
    } else {
      text = `Team ${phase.chooser.team} choosing`;
      team = phase.chooser.team;
    }
  } else if (phase.kind === "turn") {
    text = namer.turn(phase.player);
    team = teamOf(phase.player);
  }

  // Timer colour follows whoever is on the clock.
  const clockTeam: Team | undefined =
    phase.kind === "turn"
      ? teamOf(phase.player)
      : phase.kind === "choose"
        ? "player" in phase.chooser
          ? teamOf(phase.chooser.player)
          : phase.chooser.team
        : undefined;

  return (
    <header className={styles.header}>
      {!mobile && (
        <div className={styles.brand}>
          <span className={styles.logo}>Litt</span>
          <span className={styles.roomCode}>{room.code}</span>
        </div>
      )}
      <div className={styles.score} aria-label={`Score: Team A ${view.scores.A}, Team B ${view.scores.B}`}>
        <span className={styles.scoreLabel} data-team="A">
          {mobile ? "A" : "Team A"}
        </span>
        <span className={styles.scoreNum}>{view.scores.A}</span>
        <span className={styles.vs}>vs</span>
        <span className={styles.scoreNum}>{view.scores.B}</span>
        <span className={styles.scoreLabel} data-team="B">
          {mobile ? "B" : "Team B"}
        </span>
      </div>
      <div className={styles.status}>
        <div className={styles.pill} data-mine={mine || undefined} data-team={team} role="status">
          <span className={styles.pillDot} />
          {text}
        </div>
        {deadline !== null && phase.kind !== "over" && (
          <TimerRing
            deadline={deadline}
            totalSeconds={room.config.turnSeconds}
            team={clockTeam ?? "A"}
            urgent={myTurn || iChoose}
          />
        )}
        <button
          type="button"
          className={styles.mute}
          onClick={() => setMuted(!muted)}
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          title={muted ? "Unmute sounds" : "Mute sounds"}
          aria-pressed={muted}
        >
          {muted ? "♪̸" : "♪"}
        </button>
      </div>
    </header>
  );
}

function TimerRing({
  deadline,
  totalSeconds,
  team,
  urgent,
}: {
  deadline: number;
  totalSeconds: number | null;
  team: Team;
  /** The viewer is the one on the clock: pulse when low, and tick in the last 5s. */
  urgent: boolean;
}) {
  const now = useNow(250);
  const msLeft = Math.max(0, deadline - now);
  const left = Math.ceil(msLeft / 1000);
  const total = (totalSeconds ?? Math.max(left, 1)) * 1000;
  const pct = Math.max(0, Math.min(100, (100 * msLeft) / total));
  const warn = left <= 10;

  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (!urgent || left > 5 || left <= 0 || lastTick.current === left) return;
    lastTick.current = left;
    playSound("tick");
  }, [left, urgent]);

  return (
    <div
      className={styles.timer}
      data-team={team}
      data-warn={warn || undefined}
      data-pulse={(warn && urgent) || undefined}
      style={{ ["--pct" as string]: `${pct}%` }}
      role="timer"
      aria-label={`${left} seconds left`}
    >
      <span className={styles.timerInner}>{left}</span>
    </div>
  );
}
