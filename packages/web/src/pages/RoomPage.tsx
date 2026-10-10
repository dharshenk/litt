import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { ClientMessage, UserProfile } from "@litt/protocol";
import { api, loginUrl } from "../lib/api.js";
import { playSound } from "../lib/sound.js";
import { canIChoose, isMyTurn } from "../game/legal.js";
import { declaredText, gameOverText, makeNamer, timedOutText, type DeclaredEvent } from "../game/text.js";
import { useRoomConnection } from "../net/useRoomConnection.js";
import type { QueuedEvent } from "../net/roomState.js";
import { DiscordButton, GoogleButton, Logo, ReconnectBanner, type BannerState } from "../components/Misc.js";
import { ToastViewport, useToasts } from "../components/Toasts.js";
import { Lobby } from "../room/Lobby.js";
import { GameOver } from "../room/GameOver.js";
import { Table, type TableTab } from "../table/Table.js";
import type { Spot } from "../table/AskSpotlight.js";
import { DeclarationReveal } from "../table/DeclarationReveal.js";
import styles from "./RoomPage.module.css";

const GAME_OVER_DELAY_MS = 1800;

/** A wrong declaration waiting to be shown; `id` is the event's id, unique across the connection. */
interface Reveal {
  id: number;
  event: DeclaredEvent;
}

export function RoomPage() {
  const params = useParams();
  const code = (params.code ?? "").toUpperCase();
  const location = useLocation();
  const [me, setMe] = useState<UserProfile | null | undefined>(undefined);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    api.me().then(
      (u) => live && setMe(u),
      () => live && setMe(null),
    );
    return () => {
      live = false;
    };
  }, [location.key, reload]);

  if (me === undefined) return <Centered>{<span className="spinner" />}</Centered>;
  if (me === null) return <LoginGate code={code} onLogin={() => setReload((n) => n + 1)} />;
  return <Room code={code} me={me} />;
}

function Room({ code, me }: { code: string; me: UserProfile }) {
  const location = useLocation();
  const [connKey, setConnKey] = useState(0);
  const { state, dispatch, send: rawSend } = useRoomConnection(code, true, connKey);
  const { room, view, turnDeadline } = state;
  const toasts = useToasts();
  const { push, clear } = toasts;
  const [spot, setSpot] = useState<Spot | null>(null);
  const [reveals, setReveals] = useState<Reveal[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const meId = view?.me ?? me.id;
  const namer = useMemo(() => {
    const names = new Map((room?.players ?? []).map((p) => [p.id, p.displayName]));
    return makeNamer(meId, names);
  }, [room?.players, meId]);
  const myTeam = view?.myTeam ?? room?.players.find((p) => p.id === meId)?.team ?? null;

  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  useEffect(() => {
    const set = timers.current;
    return () => {
      set.forEach(clearTimeout);
      clear();
    };
  }, [clear]);

  const send = useCallback(
    (msg: ClientMessage) => {
      if (!rawSend(msg)) push("You’re offline. Reconnecting…", "error");
    },
    [rawSend, push],
  );

  // ---- One-time events → spotlight, toasts, sounds ----
  const handledUpTo = useRef(0);
  const prevEvent = useRef<string | null>(null);
  const pendingTimeout = useRef<string | null>(null);

  useEffect(() => {
    const fresh = state.events.filter((e) => e.id > handledUpTo.current);
    if (fresh.length === 0) return;
    for (const q of fresh) handleEvent(q);
    handledUpTo.current = fresh[fresh.length - 1]!.id;
    dispatch({ type: "eventsHandled", upTo: handledUpTo.current });

    function handleEvent({ id, event: ev, phaseBefore }: QueuedEvent) {
      switch (ev.type) {
        case "askSucceeded":
        case "askFailed": {
          const ok = ev.type === "askSucceeded";
          setSpot({ id, asker: ev.asker, target: ev.target, card: ev.card, ok });
          later(700, () => playSound(ok ? (ev.asker === meId ? "got" : "soft") : "fail"));
          break;
        }
        case "declared": {
          const mine = ev.team === myTeam;
          push(declaredText(ev, namer), ev.correct ? "good" : "bad");
          playSound(ev.correct ? (mine ? "win" : "soft") : mine ? "wrong" : "got");
          // A wrong declaration shows everyone who really held each card; a correct one has nothing new to show.
          if (!ev.correct) setReveals((queue) => [...queue, { id, event: ev }]);
          break;
        }
        case "timedOut":
          pendingTimeout.current = timedOutText(phaseBefore, namer);
          break;
        case "turnChanged":
          // A failed ask already says whose turn it is in the spotlight.
          if (prevEvent.current === "askFailed") break;
          if (prevEvent.current === "timedOut" && pendingTimeout.current) {
            push(`${pendingTimeout.current} ${namer.turn(ev.player)}.`, "bad");
            pendingTimeout.current = null;
          } else {
            push(`${namer.turn(ev.player)}.`, "info");
          }
          break;
        case "gameOver":
          push(gameOverText(ev), "info");
          break;
        case "chooseRequired":
          break;
      }
      prevEvent.current = ev.type;
    }
  }, [state.events, dispatch, later, meId, myTeam, namer, push]);

  // A rematch starts a fresh game; reveals nobody dismissed from the last one no longer matter.
  const inLobby = room?.status === "lobby";
  useEffect(() => {
    if (inLobby) setReveals([]);
  }, [inLobby]);

  // ---- Rejected actions ----
  const lastErrorId = state.lastError?.id;
  useEffect(() => {
    if (state.lastError) push(state.lastError.message, "error");
  }, [lastErrorId]); // only when a new error arrives

  // ---- "Your turn" cue ----
  const canAct = !!view && (isMyTurn(view) || canIChoose(view));
  const couldAct = useRef(false);
  useEffect(() => {
    if (canAct && !couldAct.current) later(350, () => playSound("turn"));
    couldAct.current = canAct;
  }, [canAct, later]);

  // ---- Reconnect banner ----
  const [banner, setBanner] = useState<BannerState>(null);
  useEffect(() => {
    if (state.connection === "reconnecting") setBanner("reconnecting");
    else if (state.connection === "open") setBanner((b) => (b === "reconnecting" ? "back" : b));
    else if (state.connection === "closed") setBanner(null);
  }, [state.connection]);
  useEffect(() => {
    if (banner !== "back") return;
    const t = setTimeout(() => setBanner(null), 1600);
    return () => clearTimeout(t);
  }, [banner]);

  // ---- Game over: give the final declaration a moment on the table when it happens live ----
  const over = room?.status === "finished" || view?.phase.kind === "over";
  // True once the table has been on screen while the game was still being played.
  const tableSeen = useRef(false);
  const [delayElapsed, setDelayElapsed] = useState(false);
  useEffect(() => {
    if (!over) {
      setDelayElapsed(false);
      return;
    }
    if (!tableSeen.current) return;
    const t = setTimeout(() => setDelayElapsed(true), GAME_OVER_DELAY_MS);
    return () => clearTimeout(t);
  }, [over]);
  // Joining a game that is already over (e.g. reconnecting) skips the delay.
  const showOver = over && (!tableSeen.current || delayElapsed);

  let body;
  let onTable = false;
  if (state.connection === "closed") {
    body = <Closed code={code} reason={state.closedReason} onRetry={() => setConnKey((k) => k + 1)} />;
  } else if (!room) {
    body = <Joining code={code} attempt={state.attempt} />;
  } else if (room.status === "lobby") {
    tableSeen.current = false;
    body = <Lobby room={room} meId={meId} send={send} />;
  } else if (showOver || (over && !view)) {
    body = <GameOver room={room} view={view} meId={meId} send={send} />;
  } else if (!view) {
    body = (
      <Centered>
        <span className="spinner" />
        <span className={styles.note}>Dealing…</span>
      </Centered>
    );
  } else {
    if (!over) tableSeen.current = true;
    onTable = true;
    const navState = location.state as { tab?: TableTab } | null;
    body = (
      <Table
        room={room}
        view={view}
        deadline={turnDeadline}
        namer={namer}
        send={send}
        spot={spot}
        onSpotDone={(id) => setSpot((s) => (s?.id === id ? null : s))}
        uiKey={location.key}
        initialTab={navState?.tab}
        errorId={state.lastError?.id ?? 0}
      />
    );
  }

  // Rendered here, not in Table, so the last set's reveal survives the switch to the game-over screen.
  const reveal = reveals[0];

  return (
    <div className={styles.room}>
      {body}
      {!onTable && <ToastViewport placement="page" />}
      {room && reveal && (
        <DeclarationReveal
          key={reveal.id}
          event={reveal.event}
          namer={namer}
          teamOf={(id) => room.players.find((p) => p.id === id)?.team ?? null}
          onClose={() => setReveals((queue) => queue.slice(1))}
        />
      )}
      <ReconnectBanner state={banner} />
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className={styles.centered}>{children}</div>;
}

function Joining({ code, attempt }: { code: string; attempt: number }) {
  const stuck = attempt >= 3;
  return (
    <Centered>
      {!stuck && <span className="spinner" />}
      <span className={styles.title}>{stuck ? `Can’t reach room ${code}` : `Joining room ${code}…`}</span>
      {stuck && (
        <>
          <span className={styles.note}>
            Check the code with whoever invited you. Still trying in the background.
          </span>
          <Link to="/" className={styles.link}>
            Back to home
          </Link>
        </>
      )}
    </Centered>
  );
}

function Closed({ code, reason, onRetry }: { code: string; reason: string | null; onRetry(): void }) {
  let title = `Disconnected from room ${code}`;
  let note = "The connection was closed.";
  let retry = true;
  if (reason === "replaced") {
    title = "Open in another tab";
    note = "You joined this room from another tab or device, so this one was disconnected.";
  } else if (reason === "ROOM_IN_PROGRESS") {
    title = "This game has already started";
    note = "Only players with a seat can rejoin. Ask for an invite to the next game.";
    retry = false;
  } else if (reason === "ROOM_FULL") {
    title = "This room is full";
    note = "The lobby has no free seats. Ask the host to make room, or start a new room.";
    retry = false;
  } else if (reason === "KICKED") {
    title = "You were removed from this room";
    note = "The host removed you from the lobby.";
    retry = false;
  } else if (reason === "ROOM_NOT_FOUND") {
    title = `Room ${code} not found`;
    note = "Check the code with whoever invited you.";
    retry = false;
  }
  return (
    <Centered>
      <span className={styles.title}>{title}</span>
      <span className={styles.note}>{note}</span>
      <div className={styles.row}>
        {retry && (
          <button type="button" className={styles.primary} onClick={onRetry}>
            Use this tab
          </button>
        )}
        <Link to="/" className={styles.secondary}>
          Back to home
        </Link>
      </div>
    </Centered>
  );
}

function LoginGate({ code, onLogin }: { code: string; onLogin(): void }) {
  const login = api.interceptLogin;
  const onMockLogin = login
    ? (e: { preventDefault(): void }) => {
        e.preventDefault();
        void login().then(onLogin);
      }
    : undefined;
  return (
    <div className={styles.gate}>
      <Logo />
      <div className={styles.gateBody}>
        <span className="label">Room · {code}</span>
        <h1 className={styles.gateTitle}>
          Take a seat
          <br />
          <em>at the table.</em>
        </h1>
        <p className={styles.note}>Log in to join this room. Your seat is saved if you get disconnected.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <DiscordButton href={loginUrl(`/r/${code}`)} onClick={onMockLogin} />
          <GoogleButton href={loginUrl(`/r/${code}`, "google")} onClick={onMockLogin} />
        </div>
        {import.meta.env.DEV && (
          <p className={styles.note}>
            Dev build: set a dev login on the <Link to="/">home page</Link> to play without Discord.
          </p>
        )}
      </div>
    </div>
  );
}
