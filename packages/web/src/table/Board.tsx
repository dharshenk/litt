import { SET_IDS, type PlayerView, type SetId, type SetStatus, type Team } from "@litt/engine";
import type { RoomSnapshot } from "@litt/protocol";
import { setInfo } from "../lib/cards.js";
import type { Namer } from "../game/text.js";
import { Avatar } from "../components/Avatar.js";
import styles from "./Board.module.css";

interface RowProps {
  label: string;
  team: Team;
  view: PlayerView;
  room: RoomSnapshot;
  namer: Namer;
  mobile: boolean;
  /** The opponent currently picked in my ask panel. */
  askingTarget: string | null;
}

export function PlayerRow({ label, team, view, room, namer, mobile, askingTarget }: RowProps) {
  const { phase } = view;
  const players = view.players.filter((p) => p.team === team);
  return (
    <section className={styles.group} aria-label={label}>
      <span className={styles.groupLabel} data-team={team}>
        {label}
      </span>
      <ul className={styles.tiles}>
        {players.map((p) => {
          const rp = room.players.find((r) => r.id === p.id);
          const active = phase.kind === "turn" && phase.player === p.id;
          const choosing = phase.kind === "choose" && "player" in phase.chooser && phase.chooser.player === p.id;
          const asking = askingTarget === p.id;
          const tag = p.outOfCards
            ? "Out of cards"
            : active
              ? "Playing"
              : choosing
                ? "Choosing"
                : asking
                  ? "Asking"
                  : "";
          return (
            <li
              key={p.id}
              className={styles.tile}
              data-player={p.id}
              data-team={p.team}
              data-active={active || undefined}
              data-asking={asking || undefined}
              data-out={p.outOfCards || undefined}
              aria-current={active ? "true" : undefined}
            >
              <Avatar
                name={rp?.displayName ?? namer.raw(p.id)}
                avatarUrl={rp?.avatarUrl}
                team={p.team}
                size={mobile ? 28 : 34}
                connected={rp?.connected ?? false}
              />
              <span className={styles.who}>
                <span className={styles.name}>{namer.name(p.id)}</span>
                <span className={styles.tag}>
                  {tag}
                  {rp && !rp.connected && <span className="sr-only"> (disconnected)</span>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const STATUS_LABEL: Record<SetStatus, string> = { ACTIVE: "Active", WON_A: "Team A", WON_B: "Team B", NULL: "Null" };

export function SetsPanel({ sets }: { sets: Record<SetId, SetStatus> }) {
  const active = SET_IDS.filter((s) => sets[s] === "ACTIVE").length;
  return (
    <section className={styles.group} aria-label="Sets">
      <div className={styles.setsHead}>
        <span className="label">Sets · most won at the end wins</span>
        <span className={styles.setsMeta}>
          {active} active · {SET_IDS.length - active} resolved
        </span>
      </div>
      <ul className={styles.sets}>
        {SET_IDS.map((s) => {
          const info = setInfo(s);
          return (
            <li key={s} className={styles.set} data-status={sets[s]}>
              <span className={styles.setName}>{info.name}</span>
              <span className={styles.setFoot}>
                <span className={styles.setRange}>{info.range}</span>
                <span className={styles.setStatus}>{STATUS_LABEL[sets[s]]}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
