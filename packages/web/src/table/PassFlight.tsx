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
const MISS_MS = 1150;

/**
 * As the spotlight reveals an ask, the asked card flies between the two player tiles:
 * handed from target to asker on a hit, thrown at the target and bounced back on a miss.
 */
export function PassFlight({ spot, teamOf }: Props) {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = layer.current;
    if (!spot || !el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const running: Animation[] = [];
    const timer = setTimeout(() => running.push(...(spot.ok ? handOver(el, spot) : bounceOff(el, spot))), REVEAL_MS);
    return () => {
      clearTimeout(timer);
      running.forEach((a) => a.cancel());
    };
  }, [spot?.id]);

  if (!spot) return null;
  return (
    <div ref={layer} className={styles.layer} data-team={teamOf(spot.asker)} aria-hidden="true">
      <PlayingCard card={spot.card} size="tiny" className={styles.card} />
      {spot.ok ? (
        Array.from({ length: SPARKS }, (_, i) => <span key={i} className={styles.spark} />)
      ) : (
        <span className={styles.nope}>✕</span>
      )}
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

/** Asker throws the card, the target shakes it off with a ✕ and it tumbles back towards the asker. */
function bounceOff(layer: HTMLElement, spot: Spot): Animation[] {
  const from = anchor(layer, spot.asker);
  const to = anchor(layer, spot.target);
  if (!from || !to) return [];
  const a = from.at;
  const hit = lerp(a, to.at, 0.82);
  const c = control(a, hit, layer);
  const impact = 0.48;
  const badge = { x: to.at.x + to.radius, y: to.at.y - to.radius };

  const flight: Keyframe[] = [{ offset: 0, transform: place(a, 0, 0.3), opacity: 0 }];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    flight.push({
      offset: 0.1 + k * (impact - 0.1),
      transform: place(bezier(a, c, hit, k * k), -10 + 30 * k, 1.25 + 0.2 * k),
      opacity: 1,
    });
  }
  // Ricochet back towards the asker, then fall away.
  const back = lerp(hit, a, 0.55);
  const rebound = { x: back.x, y: back.y - 50 };
  const drop = { x: back.x, y: back.y + 40 };
  for (let i = 1; i <= 8; i++) {
    const k = i / 8;
    flight.push({
      offset: impact + k * (1 - impact),
      transform: place(bezier(hit, rebound, drop, k), 20 - 160 * k, 1.45 - 0.5 * k),
      opacity: 1 - k * k,
    });
  }

  const hitAt = MISS_MS * impact;
  const bad = cssVar(to.tile, "--bad");
  const shake = [0, -8, 7, -5, 3, 0];
  return [
    card(layer).animate(flight, { duration: MISS_MS }),
    from.tile.animate(nudge(a, to.at), { duration: 340, easing: "ease-out" }),
    to.tile.animate(
      shake.map((dx, i) => ({
        transform: `translateX(${dx}px)`,
        boxShadow: `0 0 0 ${i === 0 || i === shake.length - 1 ? 0 : 3}px ${bad}`,
      })),
      { duration: 460, delay: hitAt - 20, easing: "ease-out" },
    ),
    layer.querySelector<HTMLElement>(`.${styles.nope}`)!.animate(
      [
        { transform: place(badge, -20, 0), opacity: 0 },
        { transform: place(badge, 8, 1.3), opacity: 1, offset: 0.18 },
        { transform: place(badge, 0, 1), opacity: 1, offset: 0.3 },
        { transform: place(badge, 0, 1), opacity: 1, offset: 0.75 },
        { transform: place({ x: badge.x, y: badge.y - 10 }, 0, 0.9), opacity: 0 },
      ],
      { duration: 1000, delay: hitAt, easing: "ease-out" },
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
