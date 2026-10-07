import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { PlayerView, SetResolution } from "@litt/engine";
import type { ClientMessage, RoomSnapshot } from "@litt/protocol";
import { setInfo } from "../lib/cards.js";
import { makeNamer } from "../game/text.js";
import { Logo } from "../components/Misc.js";
import styles from "./GameOver.module.css";

interface Props {
  room: RoomSnapshot;
  view: PlayerView | null;
  meId: string;
  send(msg: ClientMessage): void;
}

const STATUS_LABEL: Record<SetResolution["outcome"], string> = { WON_A: "Team A", WON_B: "Team B", NULL: "Null" };

export function GameOver({ room, view, meId, send }: Props) {
  const navigate = useNavigate();
  const namer = useMemo(
    () => makeNamer(meId, new Map(room.players.map((p) => [p.id, p.displayName]))),
    [room.players, meId],
  );
  const isHost = room.hostId === meId;
  const scores = view?.scores ?? { A: 0, B: 0 };
  const resolutions = view?.resolutions ?? [];
  const winner = view?.phase.kind === "over" ? view.phase.result : scores.A === scores.B ? "draw" : scores.A > scores.B ? "A" : "B";
  const myTeam = view?.myTeam ?? room.players.find((p) => p.id === meId)?.team ?? null;

  const kicker = winner === "draw" || !myTeam ? "Final" : winner === myTeam ? "You won" : "You lost";
  const nulls = resolutions.filter((r) => r.outcome === "NULL").length;
  const minutes =
    room.startedAt !== null && room.endedAt !== null
      ? Math.max(1, Math.round((room.endedAt - room.startedAt) / 60_000))
      : null;
  const meta = [
    nulls ? `${nulls} set${nulls > 1 ? "s" : ""} nullified` : null,
    view ? `${view.transferCount} transfer${view.transferCount === 1 ? "" : "s"}` : null,
    minutes !== null ? `${minutes} min` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={styles.over}>
      <section className={styles.result} data-winner={winner}>
        <Logo size={26} card={false} />
        <div className={styles.headline}>
          <span className={styles.kicker}>{kicker}</span>
          <h1 className={styles.title}>
            {winner === "draw" ? "It’s a" : `Team ${winner}`}
            <br />
            <em>{winner === "draw" ? "draw." : "wins."}</em>
          </h1>
          <div className={styles.score} aria-label={`Team A ${scores.A}, Team B ${scores.B}`}>
            <span className={styles.scoreA}>{scores.A}</span>
            <span className={styles.to}>to</span>
            <span className={styles.scoreB}>{scores.B}</span>
          </div>
          {meta && <span className={styles.meta}>{meta}</span>}
        </div>
        <div className={styles.buttons}>
          {isHost && (
            <button type="button" className={styles.rematch} onClick={() => send({ t: "room.rematch" })}>
              Rematch
            </button>
          )}
          <button type="button" className={styles.home} onClick={() => navigate("/")}>
            Back to home
          </button>
        </div>
      </section>
      <section className={styles.sets}>
        <h2 className={styles.setsTitle}>How the sets fell</h2>
        <ol className={styles.rows}>
          {resolutions.map((r) => (
            <li key={r.set} className={styles.row}>
              <span className={styles.setName}>{setInfo(r.set).full}</span>
              <span className={styles.by}>
                {r.correct ? "Declared by " : "Wrong · "}
                {namer.name(r.declaredBy)}
              </span>
              <span className={styles.chip} data-outcome={r.outcome}>
                {STATUS_LABEL[r.outcome]}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
