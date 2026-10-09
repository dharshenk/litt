import type { MouseEvent } from "react";
import styles from "./Misc.module.css";

/** The logo: a tilted paper card with an amber edge, plus the wordmark. */
export function Logo({ size = 30, card = true }: { size?: number; card?: boolean }) {
  return (
    <span className={styles.logo}>
      {card && <span className={styles.logoCard} aria-hidden="true" />}
      <span className={styles.word} style={{ fontSize: size }}>
        Litt
      </span>
    </span>
  );
}

export type BannerState = "reconnecting" | "back" | null;

export function ReconnectBanner({ state }: { state: BannerState }) {
  if (!state) return null;
  return (
    <div className={styles.banner} data-state={state} role="status" aria-live="polite">
      {state === "reconnecting" && <span className={styles.bannerSpin} aria-hidden="true" />}
      {state === "reconnecting" ? "Reconnecting…" : "Connected. You’re back in your seat."}
    </div>
  );
}

export function GoogleButton({ href, onClick }: { href: string; onClick?: (e: MouseEvent) => void }) {
  return (
    <a className={styles.google} href={href} onClick={onClick}>
      <span className={styles.googleMark} aria-hidden="true">G</span>
      Log in with Google
    </a>
  );
}

export function DiscordButton({ href, onClick }: { href: string; onClick?: (e: MouseEvent) => void }) {
  return (
    <a className={styles.discord} href={href} onClick={onClick}>
      <span className={styles.discordMark} aria-hidden="true" />
      Log in with Discord
    </a>
  );
}
