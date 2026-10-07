import { useId, type ReactNode } from "react";
import styles from "./Choice.module.css";

// Segmented controls and chip rows, built on native radio inputs so they are real
// radio groups: arrow keys move the selection, and screen readers announce them.

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

interface Props<T extends string> {
  label: string;
  value: T | null;
  options: ChoiceOption<T>[];
  onChange(value: T): void;
  disabled?: boolean;
  className?: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
  compact,
  columns,
}: Props<T> & { compact?: boolean; columns?: number }) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={[compact ? styles.segCompact : styles.seg, className].filter(Boolean).join(" ")}
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <label
          key={o.value}
          className={styles.segItem}
          data-on={o.value === value || undefined}
          data-disabled={disabled || o.disabled || undefined}
          title={o.title}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={o.value}
            checked={o.value === value}
            disabled={disabled || o.disabled}
            onChange={() => onChange(o.value)}
          />
          <span className={styles.segText}>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
  mono,
}: Props<T> & { mono?: boolean }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={[styles.chips, className].filter(Boolean).join(" ")}>
      {options.map((o) => (
        <label
          key={o.value}
          className={mono ? `${styles.chip} ${styles.mono}` : styles.chip}
          data-on={o.value === value || undefined}
          data-disabled={disabled || o.disabled || undefined}
          title={o.title}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={o.value}
            checked={o.value === value}
            disabled={disabled || o.disabled}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
