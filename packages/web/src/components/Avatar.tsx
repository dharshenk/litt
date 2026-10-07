import type { Team } from "@litt/engine";
import { initials } from "../game/text.js";
import styles from "./Avatar.module.css";

interface Props {
  name: string;
  avatarUrl?: string | null;
  team: Team | null;
  size?: number;
  /** Shows the connected dot when defined. */
  connected?: boolean;
  /** Team-coloured ring (spotlight, other player's turn). */
  ring?: boolean;
  className?: string;
}

export function Avatar({ name, avatarUrl, team, size = 34, connected, ring, className }: Props) {
  const fontSize = size >= 56 ? 15 : size >= 42 ? 14 : size >= 32 ? 12 : 11;
  return (
    <span
      className={[styles.avatar, className].filter(Boolean).join(" ")}
      data-team={team ?? undefined}
      data-ring={ring || undefined}
      style={{ width: size, height: size, fontSize }}
      aria-hidden="true"
    >
      {avatarUrl ? <img src={avatarUrl} alt="" className={styles.img} /> : initials(name)}
      {connected !== undefined && <span className={styles.dot} data-on={connected || undefined} />}
    </span>
  );
}
