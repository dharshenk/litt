import { useEffect, useRef } from "react";
import type { Team } from "@litt/engine";
import { PlayingCard } from "../components/PlayingCard.js";
import { REVEAL_MS, type Spot } from "./AskSpotlight.js";
import styles from "./PassFlight.module.css";

interface Props {
  spot: Spot | null;
  teamOf(id: string): Team;
}

interface Point {
  x: number;
  y: number;
}

interface Anchor {
  tile: HTMLElement;
  at: Point;
  radius: number;
}

const SPARKS = 10;
const HIT_MS = 1000;

/**
 * As the spotlight reveals an ask, the asked card flies between the two player tiles:
 * handed from target to asker on a hit. On a miss the target's tile just shakes.
 */
export function PassFlight({ spot, teamOf }: Props) {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = layer.current;
    if (!spot || !el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const running: Animation[] = [];
    const timer = setTimeout(() => running.push(...(spot.ok ? handOver(el, spot) : shake(el, spot))), REVEAL_MS);
    return () => {
      clearTimeout(timer);
      running.forEach((a) => a.cancel());
    };
  }, [spot?.id]);

  if (!spot) return null;
  if (!spot.ok) return <div ref={layer} className={styles.layer} aria-hidden="true" />;
  return (
    <div ref={layer} className={styles.layer} data-team={teamOf(spot.asker)} aria-hidden="true">
      <PlayingCard card={spot.card} size="tiny" className={styles.card} />
      {Array.from({ length: SPARKS }, (_, i) => (
        <span key={i} className={styles.spark} />
      ))}
    </div>
  );
}

/** Target pops the card out, it arcs over with a spin and lands on the asker in a burst. */
function handOver(layer: HTMLElement, spot: Spot): Animation[] {
  const from = anchor(layer, spot.target);
  const to = anchor(layer, spot.asker);
  if (!from || !to) return [];
  const a = from.at;
  const b = to.at;
  const c = control(a, b, layer);
  const land = 0.8;

  const flight: Keyframe[] = [{ offset: 0, transform: place(a, 0, 0.3), opacity: 0 }];
  for (let i = 0; i <= 12; i++) {
    const k = i / 12;
    flight.push({
      offset: 0.12 + k * (land - 0.12),
      transform: place(bezier(a, c, b, easeInOut(k)), -12 + 372 * easeInOut(k), 1.3 + 0.35 * Math.sin(Math.PI * k)),
      opacity: 1,
    });
  }
  flight.push(
    { offset: 0.9, transform: place(b, 360, 1.15), opacity: 1 },
    { offset: 1, transform: place(b, 360, 0.3), opacity: 0 },
  );

  const caught = HIT_MS * land - 30;
  const ok = cssVar(to.tile, "--ok");
  const sparks = [...layer.querySelectorAll<HTMLElement>(`.${styles.spark}`)].map((spark, i) => {
    const angle = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 36 + Math.random() * 22;
    const out = { x: b.x + Math.cos(angle) * dist, y: b.y + Math.sin(angle) * dist + 6 };
    return spark.animate(
      [
        { transform: place(b, 0, 1.2), opacity: 1 },
        { transform: place(out, 0, 0.2), opacity: 0 },
      ],
      { duration: 640, delay: HIT_MS * 0.88, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  });

  return [
    card(layer).animate(flight, { duration: HIT_MS }),
    from.tile.animate(nudge(a, b), { duration: 340, easing: "ease-out" }),
    to.tile.animate(
      [
        { transform: "scale(1)", boxShadow: `0 0 0 0 ${ok}` },
        { transform: "scale(1.06)", boxShadow: `0 0 0 4px ${ok}`, offset: 0.3 },
        { transform: "scale(0.98)", offset: 0.6 },
        { transform: "scale(1)", boxShadow: `0 0 0 10px transparent` },
      ],
      { duration: 560, delay: caught, easing: "ease-out" },
    ),
    ...sparks,
  ];
}

/** The asked player's tile shakes the ask off. */
function shake(layer: HTMLElement, spot: Spot): Animation[] {
  const tile = anchor(layer, spot.target)?.tile;
  if (!tile) return [];
  const bad = cssVar(tile, "--bad");
  const steps = [0, -8, 7, -5, 3, 0];
  return [
    tile.animate(
      steps.map((dx, i) => ({
        transform: `translateX(${dx}px)`,
        boxShadow: `0 0 0 ${i === 0 || i === steps.length - 1 ? 0 : 3}px ${bad}`,
      })),
      { duration: 460, easing: "ease-out" },
    ),
  ];
}

/** A player's tile and the centre of its avatar, relative to the layer. */
function anchor(layer: HTMLElement, id: string): Anchor | null {
  const root = layer.parentElement;
  const tile = root && [...root.querySelectorAll<HTMLElement>("[data-player]")].find((t) => t.dataset.player === id);
  if (!tile) return null;
  const box = layer.getBoundingClientRect();
  const r = (tile.firstElementChild ?? tile).getBoundingClientRect();
  return { tile, at: { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top }, radius: r.width / 2 };
}

const card = (layer: HTMLElement) => layer.querySelector<HTMLElement>(`.${styles.card}`)!;

const place = (p: Point, rotate: number, scale: number) =>
  `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${rotate}deg) scale(${scale})`;

/** The giving tile leans a little towards where the card goes. */
function nudge(a: Point, b: Point): Keyframe[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const dx = ((b.x - a.x) / len) * 5;
  const dy = ((b.y - a.y) / len) * 5;
  return [
    { transform: "translate(0, 0)" },
    { transform: `translate(${-dx * 0.4}px, ${-dy * 0.4}px) scale(0.98)`, offset: 0.3 },
    { transform: `translate(${dx}px, ${dy}px)`, offset: 0.6 },
    { transform: "translate(0, 0)" },
  ];
}

/** Control point that bows the path upwards, or towards the middle of the table when the path is mostly vertical. */
function control(a: Point, b: Point, layer: HTMLElement): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const mid = lerp(a, b, 0.5);
  let nx = -dy / len;
  let ny = dx / len;
  const flip = Math.abs(dx) >= Math.abs(dy) ? ny > 0 : Math.sign(nx) !== Math.sign(layer.clientWidth / 2 - mid.x);
  if (flip) {
    nx = -nx;
    ny = -ny;
  }
  const lift = Math.min(140, Math.max(50, len * 0.4));
  return { x: mid.x + nx * lift, y: mid.y + ny * lift };
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function bezier(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const cssVar = (el: HTMLElement, name: string) => getComputedStyle(el).getPropertyValue(name).trim();
