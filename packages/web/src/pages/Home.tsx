import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { PlayerStats, UserProfile } from "@litt/protocol";
import { DEV_NAME_PATTERN, api, getDevUser, loginUrl, setDevUser } from "../lib/api.js";
import { Avatar } from "../components/Avatar.js";
import { DiscordButton, Logo } from "../components/Misc.js";
import { ToastViewport, useToasts } from "../components/Toasts.js";
import styles from "./Home.module.css";

export function Home() {
  const location = useLocation();
  const navigate = useNavigate();
  const { push } = useToasts();
  /** undefined while loading, null when logged out. */
  const [me, setMe] = useState<UserProfile | null | undefined>(undefined);
  const [stats, setStats] = useState<PlayerStats[] | null>(null);
  const [reload, setReload] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.me().then(
      (user) => {
        if (!live) return;
        setMe(user);
        if (reload > 0 && getDevUser() && user === null) {
          push("Dev login is unavailable on this server. Start it with npm run dev.", "error");
        }
      },
      () => {
        if (!live) return;
        setMe(null);
        if (reload > 0 && getDevUser()) {
          push("Could not sign in. Check that the development server is running and try again.", "error");
        }
      },
    );
    api.stats().then(
      (s) => live && setStats(s),
      () => live && setStats([]),
    );
    return () => {
      live = false;
    };
  }, [location.key, reload]);

  const createRoom = async () => {
    setBusy(true);
    try {
      const { code } = await api.createRoom();
      navigate(`/r/${code}`);
    } catch {
      push("Couldn’t create a room. Check that you’re logged in and try again.", "error");
      setBusy(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (code.length >= 4) navigate(`/r/${code}`);
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    setMe(null);
  };

  const login = api.interceptLogin;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <Logo />
        <div className={styles.pitch}>
          <h1 className={styles.title}>
            Nine sets.
            <br />
            <em>Two teams.</em>
            <br />
            One memory.
          </h1>
          <p className={styles.lede}>
            Ask opponents for cards, keep track of who holds what, and declare sets with your team. Best played with
            friends on a voice call.
          </p>
          {me === null && (
            <DiscordButton
              href={loginUrl(location.pathname)}
              onClick={
                login
                  ? (e) => {
                      e.preventDefault();
                      void login().then(() => setReload((n) => n + 1));
                    }
                  : undefined
              }
            />
          )}
          {me && (
            <div className={styles.actions}>
              <button type="button" className={styles.create} onClick={createRoom} disabled={busy}>
                Create room
              </button>
              <form className={styles.join} onSubmit={join}>
                <input
                  className={styles.joinInput}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  placeholder="ROOM CODE"
                  aria-label="Room code"
                  maxLength={6}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" className={styles.joinBtn} disabled={code.length < 4}>
                  Join
                </button>
              </form>
            </div>
          )}
          <Link to="/rules" className={styles.rules}>
            How to play →
          </Link>
          {import.meta.env.DEV && (
            <DevLogin onChange={() => {
              setMe(undefined);
              setReload((value) => value + 1);
            }} />
          )}
        </div>
        {me && (
          <div className={styles.profile}>
            <Avatar name={me.displayName} avatarUrl={me.avatarUrl} team="A" size={34} />
            <div className={styles.who}>
              <span className={styles.name}>{me.displayName}</span>
              <span className={styles.via}>{me.id.startsWith("dev:") ? "Signed in with a dev login" : "Signed in with Discord"}</span>
            </div>
            <button type="button" className={styles.logout} onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </section>
      <Leaderboard stats={stats} meId={me?.id ?? null} />
      <ToastViewport placement="page" />
    </div>
  );
}

function Leaderboard({ stats, meId }: { stats: PlayerStats[] | null; meId: string | null }) {
  return (
    <aside className={styles.board}>
      <div className={styles.boardHead}>
        <h2 className={styles.boardTitle}>Leaderboard</h2>
        <span className={styles.boardKey}>W · L · D</span>
      </div>
      {stats === null && <p className={styles.boardEmpty}>Loading…</p>}
      {stats?.length === 0 && <p className={styles.boardEmpty}>No games played yet. Be the first.</p>}
      {stats && stats.length > 0 && (
        <ol className={styles.rows}>
          {stats.slice(0, 20).map((p, i) => (
            <li key={p.id} className={styles.row}>
              <span className={styles.rank}>{i + 1}</span>
              <span className={styles.player}>
                <span className={styles.pname} data-me={p.id === meId || undefined}>
                  {p.displayName}
                </span>
                <span className={styles.played}>{p.played} played</span>
              </span>
              <span className={styles.wld}>
                {p.wins} · {p.losses} · {p.draws}
              </span>
              <span className={styles.pct}>{p.played ? `${Math.round((100 * p.wins) / p.played)}%` : "—"}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

/** Dev builds only: pick a local identity per tab (sent as ?devUser=). */
function DevLogin({ onChange }: { onChange(): void }) {
  const [name, setName] = useState(() => getDevUser() ?? "");
  const stored = getDevUser();
  const valid = name === "" ? stored !== null : DEV_NAME_PATTERN.test(name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setDevUser(name || null);
    onChange();
  };
  return (
    <form className={styles.dev} onSubmit={submit}>
      <span className="label">Dev login</span>
      <div className={styles.join}>
        <input
          className={styles.devInput}
          value={name}
          onChange={(e) => setName(e.target.value.trim())}
          placeholder="name"
          aria-label="Dev login name"
          aria-invalid={!valid}
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className={styles.joinBtn} disabled={!valid}>
          {name ? "Use" : "Clear"}
        </button>
      </div>
    </form>
  );
}
