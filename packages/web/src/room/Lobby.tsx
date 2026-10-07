import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Team, WrongDeclarationMode } from "@litt/engine";
import type { ClientMessage, RoomConfig, RoomPlayer, RoomSnapshot } from "@litt/protocol";
import { joinNames, numberWord } from "../game/text.js";
import { Avatar } from "../components/Avatar.js";
import { Chips, Segmented } from "../components/Choice.js";
import styles from "./Lobby.module.css";

interface Props {
  room: RoomSnapshot;
  meId: string;
  send(msg: ClientMessage): void;
}

const MIN_PLAYERS = 6;
const TIMER_OPTIONS = ["off", "15", "30", "60", "120"] as const;

/** Why the host can't start yet, or "" when they can. */
export function startProblem(players: RoomPlayer[]): string {
  if (players.length < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players. Share the invite link.`;
  const unassigned = players.filter((p) => p.team === null);
  if (unassigned.length) return `Assign ${joinNames(unassigned.map((p) => p.displayName))} to a team.`;
  const a = players.filter((p) => p.team === "A").length;
  if (a * 2 !== players.length) return "Teams must be the same size.";
  return "";
}

export function Lobby({ room, meId, send }: Props) {
  const navigate = useNavigate();
  const isHost = room.hostId === meId;
  const host = room.players.find((p) => p.id === room.hostId);
  const problem = startProblem(room.players);
  const n = room.players.length;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const inviteUrl = `${window.location.origin}/r/${room.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      // Clipboard may be blocked; the link is visible to copy by hand.
    }
    setCopied(true);
  };

  const setTeam = (p: RoomPlayer, team: Team) =>
    send({ t: "lobby.setTeam", playerId: p.id, team: p.team === team ? null : team });

  const randomize = () => {
    const shuffled = [...room.players];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const half = Math.ceil(shuffled.length / 2);
    shuffled.forEach((p, i) => {
      const team: Team = i < half ? "A" : "B";
      if (p.team !== team) send({ t: "lobby.setTeam", playerId: p.id, team });
    });
  };

  const setConfig = (patch: Partial<RoomConfig>) =>
    send({ t: "lobby.setConfig", config: { ...room.config, ...patch } });

  const note = !isHost
    ? "The host is setting up teams."
    : n < MIN_PLAYERS
      ? `You’re the host. Waiting for at least ${MIN_PLAYERS} players.`
      : n % 2 === 1
        ? "You’re the host. You need an even number of players."
        : `You’re the host. Put ${numberWord(n / 2)} players on each team.`;

  const columns: { team: Team | null; title: string }[] = [
    { team: "A", title: "Team A" },
    { team: "B", title: "Team B" },
    { team: null, title: "Unassigned" },
  ];

  const timerValue = room.config.turnSeconds === null ? "off" : String(room.config.turnSeconds);

  return (
    <div className={styles.lobby}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <button type="button" className={styles.home} onClick={() => navigate("/")}>
            Litt
          </button>
          <span className={styles.code}>ROOM · {room.code}</span>
        </div>
        <div className={styles.invite}>
          <span className={styles.inviteUrl}>
            {window.location.host}/r/{room.code}
          </span>
          <button type="button" className={styles.copy} onClick={copy} aria-live="polite">
            {copied ? "Copied ✓" : "Copy invite"}
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <section className={styles.teams}>
          <div className={styles.teamsHead}>
            <span className={styles.note}>{note}</span>
            {isHost && n >= 2 && (
              <button type="button" className={styles.ghost} onClick={randomize}>
                Randomize teams
              </button>
            )}
          </div>
          <div className={styles.columns}>
            {columns.map((col) => {
              const players = room.players.filter((p) => p.team === col.team);
              return (
                <div key={col.title} className={styles.column} data-team={col.team ?? undefined}>
                  <div className={styles.columnHead}>
                    <span className={styles.columnTitle}>
                      <span className={styles.swatch} />
                      {col.title}
                    </span>
                    <span className={styles.count}>{players.length}</span>
                  </div>
                  {players.map((p) => (
                    <div key={p.id} className={styles.player}>
                      <Avatar
                        name={p.displayName}
                        avatarUrl={p.avatarUrl}
                        team={p.team}
                        size={32}
                        connected={p.connected}
                      />
                      <span className={styles.name}>
                        {p.displayName}
                        {p.id === meId && " (you)"}
                      </span>
                      {p.id === room.hostId && <span className={styles.host}>♛ Host</span>}
                      {isHost && (
                        <div className={styles.moves}>
                          {(["A", "B"] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={styles.move}
                              data-team={t}
                              data-on={p.team === t || undefined}
                              aria-pressed={p.team === t}
                              aria-label={`${p.team === t ? "Unassign" : "Move"} ${p.displayName} ${p.team === t ? "from" : "to"} Team ${t}`}
                              onClick={() => setTeam(p, t)}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        <aside className={styles.rules}>
          <h2 className={styles.rulesTitle}>Table rules</h2>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Wrong declaration</span>
            <Segmented<WrongDeclarationMode>
              label="Wrong declaration"
              value={room.config.wrongDeclaration}
              disabled={!isHost}
              onChange={(v) => setConfig({ wrongDeclaration: v })}
              options={[
                { value: "award", label: "Award to opponents" },
                { value: "null", label: "Nullify set" },
              ]}
            />
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel} id="history-label">
              Queryable transfers
            </span>
            <div className={styles.stepper} role="group" aria-labelledby="history-label">
              <button
                type="button"
                className={styles.step}
                aria-label="Fewer"
                disabled={!isHost || room.config.historyLimit <= 1}
                onClick={() => setConfig({ historyLimit: room.config.historyLimit - 1 })}
              >
                −
              </button>
              <span className={styles.stepValue} aria-live="polite">
                {room.config.historyLimit}
              </span>
              <button
                type="button"
                className={styles.step}
                aria-label="More"
                disabled={!isHost || room.config.historyLimit >= 10}
                onClick={() => setConfig({ historyLimit: room.config.historyLimit + 1 })}
              >
                +
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Turn timer</span>
            <Chips
              label="Turn timer"
              mono
              value={timerValue}
              disabled={!isHost}
              onChange={(v) => setConfig({ turnSeconds: v === "off" ? null : Number(v) })}
              options={TIMER_OPTIONS.map((v) => ({ value: v, label: v === "off" ? "Off" : `${v}s` }))}
            />
          </div>

          <div className={styles.startArea}>
            {isHost ? (
              <button
                type="button"
                className={styles.start}
                disabled={!!problem}
                onClick={() => send({ t: "lobby.start" })}
              >
                Start game
              </button>
            ) : (
              <div className={styles.waiting}>
                <span className="spinner" />
                Waiting for {host?.displayName ?? "the host"} to start
              </div>
            )}
            <span className={styles.reason}>{isHost ? problem : ""}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
