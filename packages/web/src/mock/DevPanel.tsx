import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { readStorage, writeStorage } from "../lib/storage.js";
import { SCENARIOS, scenarioId, type Scenario } from "./scenarios.js";
import type { MockServer } from "./server.js";
import styles from "./DevPanel.module.css";

type Theme = "auto" | "dark" | "light";
const THEMES: Theme[] = ["auto", "dark", "light"];

function applyTheme(theme: Theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** The floating PROTOTYPE panel: jump between mock scenarios. */
export function makeDevPanel(server: MockServer) {
  return function DevPanel() {
    const navigate = useNavigate();
    const [open, setOpen] = useState(() => {
      const param = new URLSearchParams(window.location.search).get("panel");
      if (param) writeStorage("session", "litt_mock_panel", param);
      return readStorage("session", "litt_mock_panel") !== "0";
    });
    const [theme, setTheme] = useState<Theme>(
      () => (document.documentElement.dataset.theme as Theme | undefined) ?? "auto",
    );
    const groups = [...new Set(SCENARIOS.map((s) => s.group))];
    const run = (s: Scenario) =>
      s.run({ server, go: (path, state) => navigate(path, { state: { ...state, mock: Date.now() } }) });

    // Deep link: ?mock=1&scenario=<id>[&theme=light][&panel=0] (handy for screenshots).
    const deepLinked = useRef(false);
    useEffect(() => {
      if (deepLinked.current) return;
      deepLinked.current = true;
      const params = new URLSearchParams(window.location.search);
      const themeParam = params.get("theme") as Theme | null;
      if (themeParam && THEMES.includes(themeParam)) {
        applyTheme(themeParam);
        setTheme(themeParam);
      }
      const id = params.get("scenario");
      const s = SCENARIOS.find((x) => scenarioId(x) === id);
      if (s) run(s);
    });

    const toggle = () => {
      writeStorage("session", "litt_mock_panel", open ? "0" : "1");
      setOpen(!open);
    };

    const cycleTheme = () => {
      const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
      applyTheme(next);
      setTheme(next);
    };

    return (
      <div className={styles.panel} aria-label="Mock scenarios">
        <button type="button" className={styles.toggle} onClick={toggle} aria-expanded={open}>
          PROTOTYPE {open ? "▾" : "▸"}
        </button>
        {open && (
          <div className={styles.list}>
            {groups.map((g) => (
              <div key={g} className={styles.group}>
                <span className={styles.groupLabel}>{g}</span>
                {SCENARIOS.filter((s) => s.group === g).map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className={styles.action}
                    title={scenarioId(s)}
                    onClick={() => run(s)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ))}
            <div className={styles.group}>
              <span className={styles.groupLabel}>Look</span>
              <button type="button" className={styles.action} onClick={cycleTheme}>
                Theme: {theme}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };
}
