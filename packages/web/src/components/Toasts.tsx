import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Card } from "@litt/engine";
import { cardFace } from "../lib/cards.js";
import styles from "./Toasts.module.css";

export type ToastKind = "info" | "good" | "bad" | "error";

export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
  card?: Card;
}

interface ToastApi {
  toasts: Toast[];
  push(text: string, kind?: ToastKind, card?: Card): void;
  clear(): void;
}

const MAX_TOASTS = 2;
const TOAST_MS = 6000;

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const set = timers.current;
    return () => set.forEach(clearTimeout);
  }, []);

  const push = useCallback((text: string, kind: ToastKind = "info", card?: Card) => {
    const id = nextId.current++;
    setToasts((ts) => [...ts, { id, text, kind, card }].slice(-MAX_TOASTS));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts((ts) => ts.filter((t) => t.id !== id));
    }, TOAST_MS);
    timers.current.add(timer);
  }, []);

  const clear = useCallback(() => setToasts([]), []);
  const api = useMemo(() => ({ toasts, push, clear }), [toasts, push, clear]);
  return <ToastContext.Provider value={api}>{children}</ToastContext.Provider>;
}

export function useToasts(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToasts outside ToastProvider");
  return api;
}

const ICON: Record<ToastKind, string> = { good: "✓", bad: "✕", info: "•", error: "!" };

/** "game" sits at the top of the table column; "page" at the bottom (top on phones). */
export function ToastViewport({ placement }: { placement: "game" | "page" }) {
  const { toasts } = useToasts();
  return (
    <div className={styles.viewport} data-placement={placement} role="status" aria-live="polite">
      {toasts.map((t) => {
        const face = t.card ? cardFace(t.card) : null;
        return (
          <div key={t.id} className={styles.toast} data-kind={t.kind}>
            <span className={face ? styles.cardChip : styles.iconChip} data-red={face?.red || undefined} aria-hidden="true">
              {face ? (face.rank === "JK" ? "★" : face.rank + face.suit) : ICON[t.kind]}
            </span>
            <span className={styles.text}>{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
