# CallSix / Literature Variant — Game Rules

> Working rules specification for the web implementation.
>
> This document describes the house-rule variant discussed for a 54-card, 9-set, two-team game.

---

## 1. Overview

The game is a team-based card game played with a standard 54-card deck:

- 52 standard playing cards
- 2 Jokers

Players are split into exactly **two teams**.

The objective is to win more complete **sets** than the opposing team by:

- tracking where cards are,
- asking opponents for specific cards,
- remembering previous transfers,
- coordinating with teammates,
- and correctly declaring complete sets.

The team with the greatest number of won sets at the end of the game wins.

---

## 2. Players and Teams

### Minimum players

The game requires at least **6 players**.

### Team sizes

- There are exactly **2 teams**.
- Both teams must contain the **same number of players**.
- Therefore, the total number of players must be even.

Examples:

| Total Players | Team Size |
|---:|---:|
| 6 | 3 vs 3 |
| 8 | 4 vs 4 |
| 10 | 5 vs 5 |
| 12 | 6 vs 6 |

---

## 3. Deck

The game uses all **54 cards**:

- 13 ranks in each of the 4 suits
- 2 Jokers

The suits are:

- Clubs ♣
- Diamonds ♦
- Hearts ♥
- Spades ♠

---

## 4. Sets

There are exactly **9 sets** in the game.

Each set contains exactly **6 cards**.

### 4.1 Low sets

For each suit, the cards from **2 through 7** form one set.

Example:

**Low Hearts**

- 2♥
- 3♥
- 4♥
- 5♥
- 6♥
- 7♥

There are four low sets:

1. 2♣–7♣
2. 2♦–7♦
3. 2♥–7♥
4. 2♠–7♠

### 4.2 High sets

For each suit, the cards from **9 through Ace** form one set.

Example:

**High Hearts**

- 9♥
- 10♥
- J♥
- Q♥
- K♥
- A♥

There are four high sets:

5. 9♣–A♣
6. 9♦–A♦
7. 9♥–A♥
8. 9♠–A♠

### 4.3 Eights and Jokers set

The ninth set consists of:

- 8♣
- 8♦
- 8♥
- 8♠
- Joker 1
- Joker 2

This is treated as one normal six-card set for gameplay purposes.

---

## 5. Setup

### 5.1 Shuffle

All 54 cards are shuffled together.

### 5.2 Deal

All cards are distributed among the players **as evenly as possible**.

The entire deck is dealt.

If 54 is not evenly divisible by the number of players, some players will begin with one more card than others.

Example with 8 players:

- 6 players receive 7 cards each
- 2 players receive 6 cards each

because:

```text
6 × 7 + 2 × 6 = 54
```

There is no draw pile.

---

## 6. Starting the Game

One player is chosen to take the first turn.

The method used to choose the starting player is not important to the rules and may be random or agreed by the group.

Only one player is the **active player** at any moment.

---

## 7. The Core Turn

During their turn, the active player may ask an opponent for a specific card.

A request has the form:

> “Player X, do you have 5♥?”

The active player must choose:

1. one player from the opposing team, and
2. one specific card.

The request must satisfy all card-request rules below.

---

## 8. Rules for Asking for a Card

A card request is legal only if all of the following are true.

### Rule 1 — The target must be an opponent

A player may only ask someone on the **opposing team**.

A player may not ask a teammate for a card.

### Rule 2 — The asker must not already own the requested card

A player cannot request a card already in their own hand.

Example:

If Alice already has 4♥, Alice cannot ask:

> “Bob, do you have 4♥?”

### Rule 3 — The asker must have a base card from the same set

The active player must personally hold at least one card belonging to the same six-card set as the card they are requesting.

This card is referred to as a **base card**.

Example:

Alice has 3♥.

Because 3♥ belongs to the **2♥–7♥ set**, Alice may legally request any other card in that same set that she does not already own:

- 2♥
- 4♥
- 5♥
- 6♥
- 7♥

Alice may not use 3♥ as a base card to request something from an unrelated set such as K♠.

### Rule 4 — A player cannot ask from a set they do not currently possess

If the active player personally holds no cards from a particular set, they cannot ask for cards from that set.

Knowing that a teammate possesses a card from the set does **not** count as having a base card.

The active player themselves must currently possess at least one card from that set.

---

## 9. Successful Request

If the targeted opponent has the requested card:

1. the opponent must give the card to the active player;
2. ownership of the card immediately changes;
3. the transfer becomes a successful card transaction;
4. the active player keeps the turn.

The player may then make another legal request.

The next request may target:

- the same opponent, or
- any other opponent.

There is no fixed limit to the number of consecutive successful requests a player may make.

A turn may therefore continue through many successful card transfers.

---

## 10. Failed Request

If the targeted opponent does **not** possess the requested card:

1. no card is transferred;
2. the active player's turn immediately ends;
3. the player who was asked becomes the new active player.

Example:

- Alice asks Bob for Q♠.
- Bob does not have Q♠.
- Bob now gets the turn.

---

## 11. Declaring a Set

During their turn, the active player may attempt to **declare a set**.

A declaration claims that the active player's team currently possesses all six cards belonging to one set.

Simply knowing that the team owns the set is not enough.

The declaring player must correctly state **exactly which player on their team owns each card**.

---

## 12. Exact Ownership Requirement

A valid declaration must account for all six cards in the set.

Example declaration for the 2♥–7♥ set:

```text
Alice:
- 2♥
- 5♥

Charlie:
- 3♥
- 4♥

Eve:
- 6♥
- 7♥
```

The declaration is correct only if every stated card location is correct at the moment of declaration.

The declaring player may include themselves in the declaration.

Example:

```text
I have:
- 2♥
- 3♥

Charlie has:
- 4♥

Eve has:
- 5♥
- 6♥
- 7♥
```

is valid if those locations are accurate.

---

## 13. Correct Declaration

If every card in the declaration is correctly assigned:

1. the declaring team wins the set;
2. the set is marked as completed;
3. those six cards are removed from active gameplay;
4. those cards can no longer be requested or transferred;
5. the team's score increases by 1.

After successfully declaring the set, the declaring player may **transfer the chance to someone on their own team**.

The exact behavior for whether the declaring player may choose themselves should be finalized before implementation.

---

## 14. Incorrect Declaration

Before the game begins, the players must choose how an incorrect declaration will be handled.

There are two supported rule modes.

### Mode A — Opponent Award

If a team makes an incorrect declaration:

1. the declaration fails;
2. the entire set is awarded to the opposing team;
3. the opposing team's score increases by 1;
4. the set is removed from further play.

### Mode B — Null Set

If a team makes an incorrect declaration:

1. the declaration fails;
2. neither team receives the set;
3. the set becomes **null**;
4. the six cards are removed from further play;
5. neither team's score increases.

Because a set can become null, this mode can result in a tied final score.

---

## 15. Declaration Rule Must Be Chosen Before the Game

The incorrect-declaration behavior must be agreed upon before the first turn.

A game therefore has one of the following rule configurations:

```text
Wrong Declaration:
[ ] Award set to opponent
[ ] Nullify set
```

This rule cannot be changed after the game begins.

---

## 16. Transaction History and Memory

Memory is an important part of the game.

There are two separate concepts:

1. what a player personally remembers;
2. what recent card transactions may still be formally asked about or checked.

---

## 17. Personal Memory Is Unlimited

Players are allowed to remember as much previous gameplay information as they are capable of remembering.

There is no rule requiring a player to forget older events.

For example, a player may remember that:

> “Several turns ago, Bob received 6♠ from Alice.”

Even if that transaction is no longer one of the last three, the player is free to use that remembered information when making strategic decisions.

The game should never prevent a player from acting based on their own memory.

---

## 18. Only the Last Three Transactions Are Queryable

At any moment, players may only formally ask for or inspect information about the **three most recent successful card-transfer transactions**.

Example transaction history:

```text
Transaction 21:
Alice → Bob: 5♥

Transaction 22:
David → Charlie: K♠

Transaction 23:
Bob → David: 3♦
```

These three transactions are currently queryable.

If another successful transfer occurs:

```text
Transaction 24:
Charlie → Alice: 7♣
```

the queryable history becomes:

```text
Transaction 22:
David → Charlie: K♠

Transaction 23:
Bob → David: 3♦

Transaction 24:
Charlie → Alice: 7♣
```

Transaction 21 is no longer formally queryable.

A player who personally remembers Transaction 21 may still use that information.

---

## 19. What Counts as a Transaction

For the purpose of the last-three rule, a **transaction** is a successful transfer of a card caused by a correct request.

Example:

```text
Alice asks Bob for 5♥.
Bob has 5♥.
Bob gives 5♥ to Alice.
```

This is one transaction.

A failed request does not transfer a card and therefore does not create a successful card-transfer transaction.

Declarations are separate game events and are not card-request transactions.

---

## 20. Information Available to Players

During the game, each player knows:

- all cards currently in their own hand;
- which sets have already been resolved;
- the current score;
- whose turn it is;
- the three most recent queryable successful transactions;
- anything else they personally remember from previous gameplay.

A player does **not** automatically know:

- the current hands of teammates;
- the current hands of opponents;
- where every card currently resides.

Those locations must be inferred through gameplay and memory.

---

## 21. Turn Flow Summary

```text
START TURN
    |
    v
Active player chooses:
    |
    +----> Ask opponent for a card
    |          |
    |          +---- Opponent has card?
    |                    |
    |                    +---- YES
    |                    |      |
    |                    |      v
    |                    |   Transfer card
    |                    |      |
    |                    |      v
    |                    |   Record transaction
    |                    |      |
    |                    |      v
    |                    |   Same player continues
    |                    |
    |                    +---- NO
    |                           |
    |                           v
    |                       Turn passes to
    |                       targeted opponent
    |
    +----> Declare a set
               |
               +---- Correct?
                      |
                      +---- YES
                      |      |
                      |      v
                      |   Team wins set
                      |      |
                      |      v
                      |   Declaring player transfers
                      |   chance to a teammate
                      |
                      +---- NO
                             |
                             +---- Opponent Award mode
                             |       -> Opponent wins set
                             |
                             +---- Null Set mode
                                     -> Set becomes null
```

---

## 22. Set Status

Every set can have one of the following statuses:

```text
ACTIVE
WON_BY_TEAM_A
WON_BY_TEAM_B
NULL
```

Initially, all nine sets are `ACTIVE`.

Once a set has been won or nullified, it can never return to active play.

---

## 23. Scoring

Each won set is worth:

```text
1 point
```

There are 9 total sets.

Example:

```text
Team A: 5 sets
Team B: 4 sets
```

Team A wins.

In Null Set mode, some sets may belong to neither team.

Example:

```text
Team A: 4 sets
Team B: 4 sets
Null:   1 set
```

The game ends in a draw.

---

## 24. End of the Game

The game ends once all nine sets have been resolved.

A resolved set is one that is:

- won by Team A,
- won by Team B,
- or nullified.

The team with the larger number of won sets wins.

If both teams have the same number of won sets, the game is a draw.

A draw is normally only possible when the **Null Set** incorrect-declaration rule is enabled.

---

## 25. Strategic Consequences

These are not additional rules, but are useful consequences of the rules.

### Successful asks reveal information

When a player successfully asks for a card, everyone knows the asker received that card unless it later moves again or the set is resolved.

### Failed asks also reveal information

If Alice asks Bob for K♠ and Bob does not have it, players learn that Bob did not possess K♠ at that moment.

That information can become stale later because Bob may subsequently receive K♠.

### Requests reveal set access

Because a player may only request a card from a set they personally possess, every legal request proves that the asker held at least one card from that set at the moment of the request.

### Card knowledge becomes stale

Knowing where a card was previously located does not guarantee that it is still there.

Cards continuously move between players.

### A declaration requires exact team-wide knowledge

A team may collectively possess all six cards of a set while still being unable to safely declare it if the active player does not know exactly who owns each card.

---

## 26. Example Turn

Assume the teams are:

```text
Team A:
- Alice
- Charlie
- Eve

Team B:
- Bob
- David
- Frank
```

Alice is active.

Alice currently has:

```text
3♥
7♥
K♣
```

Because Alice has cards from the 2♥–7♥ set, she may ask an opponent for another card from that set.

Alice asks:

> “Bob, do you have 5♥?”

Bob has 5♥.

Bob transfers 5♥ to Alice.

The transaction is recorded:

```text
Bob → Alice: 5♥
```

Alice keeps the turn.

Alice then asks:

> “David, do you have 6♥?”

David does not have 6♥.

No card moves.

Alice's turn ends.

David becomes the new active player.

---

## 27. Example Declaration

Later, Charlie believes Team A owns the entire low-Hearts set.

Charlie declares:

```text
Alice:
- 2♥
- 5♥

Charlie:
- 3♥

Eve:
- 4♥
- 6♥
- 7♥
```

If this is exactly correct:

```text
Team A +1 set
Low Hearts -> WON_BY_TEAM_A
```

Those six cards leave active play.

Charlie then transfers the chance to someone on Team A.

---

## 28. Example Incorrect Declaration

Suppose Charlie makes the same declaration, but in reality Bob still owns 7♥.

The declaration is wrong.

### If Opponent Award mode is enabled

```text
Low Hearts -> WON_BY_TEAM_B
Team B +1
```

### If Null Set mode is enabled

```text
Low Hearts -> NULL
No points awarded
```

---

## 29. Suggested Web-App Rule Configuration

Before creating a room, the host should be able to configure:

```text
Players:
- Minimum: 6
- Must be even

Teams:
- 2
- Equal size

Wrong declaration:
- Award set to opponent
- Nullify set

Recent transaction query limit:
- 3
```

The transaction limit is part of this house-rule variant and should default to 3.

---

## 30. Suggested Game-State Model

A future implementation can represent the important game state approximately as:

```text
Game
├── players
├── teams
├── currentPlayer
├── playerHands
├── activeSets
├── completedSets
├── nullSets
├── scores
├── transactionHistory
├── wrongDeclarationRule
└── gameStatus
```

Each card should have exactly one current state:

```text
IN_PLAYER_HAND
IN_COMPLETED_SET
IN_NULL_SET
```

A card must never exist in two locations simultaneously.

---

## 31. Core Invariants

The implementation should always enforce the following:

1. Exactly 54 cards exist.
2. Every card belongs to exactly one of the 9 sets.
3. Every set contains exactly 6 cards.
4. There are exactly two teams.
5. Both teams contain the same number of players.
6. Only the active player may make a request or declaration.
7. A card can only be requested from an opponent.
8. A player cannot request a card they already hold.
9. A player must personally possess another card from the requested card's set.
10. A successful request transfers exactly one card.
11. A successful request does not change the active player.
12. A failed request passes the turn to the targeted opponent.
13. A declaration must account for all six cards in the set.
14. A resolved set cannot be requested again.
15. Only the three latest successful card-transfer transactions are formally queryable.
16. Older transactions may still be remembered and acted upon by players.
17. The game ends when all 9 sets are resolved.

---

## 32. Rules Still Worth Finalizing Before Implementation

The core game is defined, but a few implementation-level behaviors should eventually be made explicit.

### 32.1 Can the declaring player select themselves after a successful declaration?

Current wording:

> The declaring player can transfer their chance to someone on their team.

Possible interpretations:

- they may choose themselves; or
- they must choose a different teammate.

This should be finalized.

### 32.2 What happens to the turn after an incorrect declaration?

The set outcome is defined, but the next active player after a failed declaration has not yet been explicitly defined.

This should be agreed before implementing declarations.

### 32.3 Does declaring require a base card?

The current understanding is that the active player may declare any unresolved set if they believe their team owns all six cards.

If the declaring player must personally hold a card from that set, that requirement should be added explicitly.

---

## 33. Short Rules Reference

1. Split players evenly into two teams.
2. Shuffle and deal all 54 cards as evenly as possible.
3. There are 9 sets of 6 cards each.
4. One player starts.
5. On your turn, ask an opponent for one specific card.
6. You must already hold another card from that card's set.
7. If they have it, they give it to you and you continue.
8. If they do not have it, they get the turn.
9. During your turn, you may declare a set.
10. A declaration must correctly identify who on your team owns every card in that set.
11. Correct declaration = your team wins the set.
12. Incorrect declaration = opponent gets the set OR the set becomes null, depending on the rule selected before the game.
13. Players may remember anything they want.
14. Only the last 3 successful card transfers may be formally queried.
15. The game ends when all 9 sets are resolved.
16. The team with the most sets wins.

---

## 34. Finalized Decisions (v1)

These resolve the open questions in §32 and other implementation-level gaps.

### 34.1 Gameplay rules

1. **Turn after a correct declaration** — the declarer passes the turn to any teammate, **including themselves**.
2. **Turn after an incorrect declaration** — the **opposing team chooses** which of its players takes the turn.
3. **Declaring requires a base card** — the declaring player must personally hold **at least one card** from the set being declared.
4. **Active player has no cards** — they pass the turn to a teammate who still holds cards.
5. **Asking an empty-handed player** — not allowed. Players with no cards cannot be targeted.
6. **A team runs out of cards** — the other team must keep taking turns and declaring the remaining sets.
7. **Hand sizes are hidden** — players cannot see how many cards others hold.
8. **Failed asks** — shown to everyone as a brief, one-time notice, then removed. They are never part of the queryable history.
9. **Table talk** — teammates may not discuss their hands (honor system; not enforced by the app).
10. **Teams and first player** — the host assigns teams; the app picks the first player at random.
11. **Out-of-cards is public** — exact hand sizes stay hidden (34.1.7), but whether a player has zero cards is visible to everyone.
12. **Turn timer expiry** — the turn passes to a random opponent who still holds cards.
13. **Incorrect declaration when the opposing team has no cards** — the declaring team keeps the turn and chooses which of its players takes it.
14. **Incorrect declaration reveals the cards** — everyone is shown who actually held each of the set's six cards. The set leaves play, so no other hand is exposed.

### 34.2 Room configuration (set by host before the game)

- Wrong declaration: award to opponent / nullify
- Recent transaction query limit (default 3)
- Optional per-turn timer

### 34.3 App features

- Platform: web app, link shared in Discord (players use Discord voice alongside).
- Players can rejoin their seat after disconnecting.
- Per-player win/loss stats are stored across games.

### 34.4 Implementation decisions

- TypeScript throughout; no game/multiplayer framework — rooms, reconnection and timers are hand-written.
- Rules engine is a pure, framework-independent module with its own tests.
- v1 must be easy and free to host.
- Login is **Discord OAuth only** (`identify` scope). Players are keyed by Discord user ID.

### 34.5 Still open

- Hosting platform.

---

## Version

```text
Rules document version: 0.1
Game variant: 54-card / 9-set Literature-style house rules
```

