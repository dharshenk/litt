# Contract change requests

Agents: append requests here instead of editing contract files. Use the format below.

```text
## Task 0N — <short title>
File: <contract file>
Change: <what>
Why: <reason>
Workaround used: <what you did meanwhile>
```

## Table update - recent ask outcomes
File: packages/engine/src/types.ts
Change: Add bounded askHistory to GameState and recentAsks to PlayerView, with seq, asker, target, card and ok. Clarify that historyLimit also limits recent asks.
Why: The table must show the latest asks, including failed attempts, rather than only successful transfers.
Workaround used: asks.ts provides typed extensions and legacy-transfer fallbacks without changing the read-only contract. The engine persists askHistory and playerView includes recentAsks. Existing transfer history and counters are unchanged.
