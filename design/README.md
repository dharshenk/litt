# Handoff: Litt web client (`@litt/web`)

## Overview
UI design for the Litt web client described in `tasks/03-web.md`: home, lobby, game table (ask / declare / choose), and game over, desktop and 360px+ phones, light and dark.

## About the design files
The `.dc.html` files are **design references built in HTML**, not production code. Recreate them in `packages/web` with the stack in `tasks/03-web.md` (React 19, Vite, plain CSS with CSS variables, no UI framework). Open the files in a browser (keep `support.js` next to them).

- `Litt Prototype.dc.html`: a playable prototype. You play as "dharshen" against 5 bots. The bottom-left **PROTOTYPE** panel jumps between states (like the required `?mock=1` dev panel).
- `Litt Mockups.dc.html`: static boards of the main screens (1a–1g).

The prototype's game logic (bots, dealing, legality) is a stand-in for the server. **Don't port it.** The real client is driven entirely by `PlayerView` and `ServerMessage`s.

## Fidelity
**High fidelity.** Match the colors, type, spacing and motion below.

## Design tokens (CSS variables, on root; `[data-theme=light]` overrides; default follows `prefers-color-scheme`)
| Token | Dark | Light | Use |
|---|---|---|---|
| --bg | #121a16 | #f2efe7 | app background |
| --bg2 | #16201b | #e9e5da | side panels |
| --felt | #1c2b24 | #faf8f3 | radial table glow: `radial-gradient(80% 70% at 50% 45%, var(--felt), var(--bg) 85%)` |
| --surf / --surf2 | rgba(255,255,255,.04/.08) | rgba(20,30,25,.04/.08) | tiles, segmented bg |
| --line / --line2 | rgba(255,255,255,.07/.14) | rgba(20,30,25,.09/.18) | borders |
| --ink / --ink2 / --mute / --faint | #ecefe9 / #b9c3bc / #8d9a92 / #5f6b64 | #18201b / #3d4842 / #5a665f / #98a29b | text |
| --A (Team A fill) | oklch(0.74 0.12 60) | oklch(0.78 0.13 68) | amber |
| --Atx (Team A text) | oklch(0.82 0.1 60) | oklch(0.5 0.12 55) | |
| --Asoft / --Aline | --A at 13% / 40% | 20% / 55% | won-set tile, active tile |
| --B / --Btx | oklch(0.72 0.12 240) / oklch(0.82 0.09 240) | oklch(0.6 0.13 245) / oklch(0.45 0.12 245) | blue |
| --onA | #1b1408 | #1b1408 | text on amber buttons |
| --paper | #f7f5ef | #ffffff | playing cards |
| --red / --blk | oklch(0.55 0.19 27) / #1b1d1c | same | suit colors (♥♦ and red joker = red) |
| --ok / --bad | #5fc28a / oklch(0.68 0.18 25) | #2f9a5e / oklch(0.55 0.2 25) | success / fail / timer warn |
| --btn / --btnInk | #ecefe9 / #121a16 | #18201b / #f2efe7 | selected segment / primary neutral button |
| --sheet | #18231e | #fbfaf6 | modals, bottom sheet, ask spotlight |
| --cardSh | 0 1px 0 rgba(0,0,0,.2), 0 10px 24px rgba(0,0,0,.35) | lighter | card shadow |

**Type:** Instrument Serif 400 for display (logo 26–30px, headings 28–38px, score 40px desktop / 30px mobile, hero 76/50px). Geist 400/500/600 for UI (14px body, 13px buttons, 11px uppercase section labels with .12em tracking). Geist Mono for codes, counts, timer and the transfer numbers.

**Radii:** cards 9px (12px large), tiles 12–14px, buttons 10–12px, chips 7–8px, pills 999px, modal 20–22px.

Primary CTA: 48–52px tall, amber (`--A` / `--onA`). Disabled: `--surf2` bg, `--faint` text.

## Screens
### Home `/`
Two columns: hero (flex, padding 56/64) and leaderboard (420px, `--bg2`). On phones they stack.
- Logged out: "Log in with Discord" (#5865f2). Logged in: "Create room" (amber), plus a room-code input (uppercased, mono, .15em tracking) with "Join". Below: avatar, name and "Log out".
- Leaderboard columns: rank, name, played, W · L · D, win %.

### Lobby `/r/:code`
- Header: room code and a copyable invite link ("Copy invite", then "Copied ✓" for 1.6s).
- Three columns: Team A (amber tint), Team B (blue tint), Unassigned. Each player row has avatar, connected dot, name, "♛ Host" and A/B move buttons (host only).
- Right panel (340px): "Table rules". Wrong declaration is a segmented control. History limit is a −/+ stepper (1–10). Turn timer chips: Off/15/30/60/120.
- "Start game" is disabled with the reason shown underneath ("Assign X to a team." / "Teams must be the same size."). Non-hosts see read-only controls and "Waiting for <host> to start".

### Game table
Desktop: header 72px. Body grid is `minmax(0,1fr) 340px` (main table + action panel).
- **Header:** logo + code | score "Team A n vs n Team B" | status pill + timer ring + mute.
  - Status pill: amber filled "Your turn" / "You pick next"; outlined in team colour for others ("Bob's turn", "Team B choosing").
  - Timer ring: conic progress in the active team's colour. At ≤10s it turns `--bad` and pulses (scale 1.08, 1s). In the last 5s it ticks.
- **Players:** opponents row, then your-team row. Labels and avatars use each team's real colour.
  - Tile: avatar + connected dot, name, tag ("Playing" / "Out of cards").
  - Active player: team-soft background, team-colour border, pulsing glow (1.8s).
  - Out of cards: 45% opacity. **Never show hand sizes.**
- **Sets:** 9 tiles (name, range, status Active / Team A / Team B / Null). 9 columns at ≥1340px wide, otherwise `repeat(auto-fill,minmax(92px,1fr))`; 3 columns on phones.
- **Your hand:** grouped by set, labelled "Low ♥ (2–7)", "High ♠ (9–A)", "8s & Jokers".
  - Cards 64×90 (44×62 on phones), overlapping by −20px.
  - The group for the set being asked about or declared lifts 8px.
- **Action panel:** depends on the phase.
  - My turn: Ask / Declare segmented control.
    - Ask: 1) set chips (active sets I hold that I'm not complete in), 2) mini cards (cards in that set I don't hold), 3) opponent radio list (out-of-cards rows dashed and disabled). The button reads "Ask Bob for 5♥".
    - Declare: 1) set chips (active sets I hold), 2) six rows (card + segmented teammate picker; my own cards prefilled and locked). The button shows "Assign N more", then "Review declaration".
  - Someone else's turn: a pulsing avatar and "Bob's turn".
  - Choose phase, me choosing: a list of eligible players ("Pick who plays next").
  - Choose phase, someone else choosing: a spinner and "Waiting for X to pick who plays next".
  - Below: **Recent transfers** (last N, newest first, "#14 Maya → Bob [4♣]"). The current one is tinted green with a "Now" tag.
- **Review modal:** cards grouped by teammate, plus "This cannot be undone. A wrong declaration gives the set to the other team." (or "…nullifies the set."). Buttons: Back / Declare set.
- **Ask spotlight** (centred over the table, `pointer-events:none`, `aria-live`):
  - Layout: asker → "asks" arrow → target, then the large requested card (96×134; 64×90 on phones).
  - 0–0.7s: grey, "Asking…".
  - Then green "Transfer #n" (card lifts/tilts, green ring) or red "Failed ask" (card 50% opacity, red ring), plus a result line ("Bob had it — 5♥ goes to Maya" / "Bob doesn't have it — Bob's turn").
  - It fades out at 3.2s.
- **Toasts** (declarations, turn passes, timeouts): max 2, auto-dismiss after 6s. Desktop: top of the table column. Phones: below the header.
- **Reconnect banner:** a 34px top bar, amber "Reconnecting…" with a spinner, then green "Connected. You're back in your seat."

Phones (<820px): compact header, transfers shown inline above the hand, and a bottom bar with Ask / Declare (or "Pick who plays next"). The action panel opens as a bottom sheet (max 86% height, 22px top radius, slides up in .3s) over a scrim.

### Game over
- Left: result ("Team A wins." / "It's a draw."), big score in team colours, a meta line (nulls · transfers · minutes), Rematch (host) / Back to home.
- Right: "How the sets fell", one row per set (declared by whom, status chip).

## Interactions and motion
- Deal: cards drop in (`translateY(-40px) scale(.85) rotate(-6deg)` → none, .5s, stagger 40ms, `cubic-bezier(.2,.8,.2,1)`). A card you receive replays the same animation.
- Toasts slide up 14px in .3s. Modals fade/scale in from .98 over .25s. Set tiles transition their colours over .5s.
- Sounds (Web Audio, mutable): your turn, card received, failed ask, correct/wrong declaration, timer tick. Optional; the task says to keep these simple.

## State (maps to tasks/03-web.md)
Reducer over `ServerMessage`s, holding `room`, `view`, `turnDeadline`, the toast queue and the last error. Local UI state: ask {set, card, target}, declare {set, assignment, reviewOpen}, sheetOpen, the current ask spotlight (from the `askSucceeded` / `askFailed` events), and muted. Legality lives in `src/game/legal.ts`, as specified.

## Files
- `Litt Prototype.dc.html`: interactive reference (Tweaks: theme auto/dark/light, layout auto/phone, sound, dev panel).
- `Litt Mockups.dc.html`: static screen boards.
- `support.js`: runtime needed to open the `.dc.html` files.

Fonts: Google Fonts Instrument Serif, Geist and Geist Mono. No image assets; cards are CSS/Unicode.
