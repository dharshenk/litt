import { expect, test, type APIRequestContext, type Browser, type Page, type TestInfo } from "@playwright/test";
import { cardsInSet, setOf, type Card, type GameState, type SetId, type Team } from "@litt/engine";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE_URL = "http://127.0.0.1:5173";
const SERVER_URL = "http://localhost:8787";
const PLAYER_NAMES = ["alice", "bob", "carol", "dave", "erin", "frank"];

interface PlayerTab {
  name: string;
  id: string;
  page: Page;
  close(): Promise<void>;
}

interface Ask {
  target: string;
  card: Card;
  succeeds: boolean;
}

function cardLabel(card: Card): string {
  if (card === "JK1") return "Red Joker";
  if (card === "JK2") return "Black Joker";
  const suit = { C: "\u2663\uFE0E", D: "\u2666\uFE0E", H: "\u2665\uFE0E", S: "\u2660\uFE0E" }[card.at(-1)! as "C" | "D" | "H" | "S"];
  return `${card.slice(0, -1)}${suit}`;
}

function findFullSet(state: GameState, team: Team, player: string): SetId | null {
  for (const set of Object.keys(state.sets) as SetId[]) {
    if (state.sets[set] !== "ACTIVE" || !state.hands[player]?.some((card) => setOf(card) === set)) continue;
    const cards = cardsInSet(set);
    if (cards.every((card) => {
      const holder = state.players.find((seat) => state.hands[seat.id]?.includes(card));
      return holder?.team === team;
    })) return set;
  }
  return null;
}

function chooseNext(state: GameState): { actor: string; choice: string } {
  if (state.phase.kind !== "choose") throw new Error("Expected choose phase");
  const chooser = state.phase.chooser;
  const actor = "player" in chooser
    ? chooser.player
    : state.players.find((player) => player.team === chooser.team)?.id;
  if (!actor) throw new Error("No player can make the team choice");
  const choice = state.phase.eligible.find((player) => {
    const team = state.players.find((seat) => seat.id === player)!.team;
    return findFullSet(state, team, player) !== null;
  }) ?? state.phase.eligible[0];
  if (!choice) throw new Error("Choose phase has no eligible players");
  return { actor, choice };
}

function findAsk(state: GameState, player: string, forceFailure: boolean): Ask | null {
  const team = state.players.find((seat) => seat.id === player)?.team;
  if (!team) throw new Error(`Unknown active player ${player}`);
  const targets = state.players.filter((seat) => seat.team !== team && state.hands[seat.id]?.length);
  const bases = state.hands[player] ?? [];
  let failed: Ask | null = null;
  for (const base of bases) {
    const set = setOf(base);
    if (state.sets[set] !== "ACTIVE") continue;
    for (const card of cardsInSet(set)) {
      if (bases.includes(card)) continue;
      for (const target of targets) {
        if (state.hands[target.id]!.includes(card)) {
          if (forceFailure) continue;
          return { target: target.id, card, succeeds: true };
        }
        failed ??= { target: target.id, card, succeeds: false };
      }
    }
  }
  return failed;
}

async function gameState(request: APIRequestContext, code: string): Promise<GameState> {
  const response = await request.get(`${SERVER_URL}/api/dev/rooms/${code}/state`);
  expect(response.status()).toBe(200);
  return await response.json() as GameState;
}

async function newPlayers(browser: Browser): Promise<PlayerTab[]> {
  const players: PlayerTab[] = [];
  for (const name of PLAYER_NAMES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await page.getByLabel("Dev login name").fill(name);
    await page.getByRole("button", { name: "Use", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
    players.push({ name, id: `dev:${name}`, page, close: () => context.close() });
  }
  return players;
}

async function createAndJoinRoom(players: PlayerTab[]): Promise<string> {
  const host = players[0]!;
  await host.page.getByRole("button", { name: "Create room" }).click();
  await expect(host.page).toHaveURL(/\/r\/[A-Z0-9]{4}$/);
  const code = new URL(host.page.url()).pathname.split("/").at(-1)!;
  const invite = await host.page.locator("header").getByText(new RegExp(`/r/${code}$`)).textContent();
  expect(invite).toContain(code);
  const inviteUrl = `http://${invite!.trim()}`;
  for (const player of players.slice(1)) {
    await player.page.goto(inviteUrl);
    await expect(player.page.getByText(`${player.name} (you)`, { exact: true })).toBeVisible();
  }
  await expect(host.page.getByText(`${host.name} (you)`, { exact: true })).toBeVisible();
  return code;
}

async function configureLobby(players: PlayerTab[]): Promise<void> {
  const host = players[0]!.page;
  for (let index = 0; index < players.length; index++) {
    const player = players[index]!;
    const team = index < 3 ? "A" : "B";
    await host.getByRole("button", { name: `Move ${player.name} to Team ${team}`, exact: true }).click();
  }
  await host.getByRole("radiogroup", { name: "Wrong declaration" })
    .getByRole("radio", { name: "Award to opponents" }).check({ force: true });
  await host.getByRole("radiogroup", { name: "Turn timer" })
    .getByRole("radio", { name: "Off" }).check({ force: true });
  await expect(host.getByRole("button", { name: "Start game" })).toBeEnabled();
  await Promise.all(players.map((player) => expect(player.page.getByText("Start game")).toBeVisible().catch(() => undefined)));
}

async function handLabels(page: Page): Promise<string[]> {
  return page.getByRole("region", { name: "Your hand" }).getByRole("img").evaluateAll((images) =>
    images.map((image) => image.getAttribute("aria-label") ?? ""),
  );
}

async function assertClients(state: GameState, players: PlayerTab[]): Promise<void> {
  if (state.phase.kind === "over") {
    await Promise.all(players.map((player) => expect(player.page.getByText("How the sets fell")).toBeVisible({ timeout: 10_000 })));
  } else {
    await Promise.all(players.map(async (player) => {
      const expected = (state.hands[player.id] ?? []).map(cardLabel).sort();
      await expect.poll(() => handLabels(player.page).then((labels) => labels.sort()), { timeout: 10_000 }).toEqual(expected);
    }));
  }
  const expectedScore = `${state.scores.A}:${state.scores.B}`;
  await expect.poll(async () => Promise.all(players.map(async (player) => {
    const label = await player.page.locator('[aria-label^="Score: Team A"], [aria-label^="Team A "]').first().getAttribute("aria-label");
    const match = label?.match(/Team A (\d+)[,\s]+Team B (\d+)/);
    return match ? `${match[1]}:${match[2]}` : "missing";
  })), { timeout: 10_000 }).toEqual(players.map(() => expectedScore));
}

async function captureVisual(testInfo: TestInfo, label: string, page: Page): Promise<void> {
  const directory = testInfo.outputPath("visuals");
  await mkdir(directory, { recursive: true });
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    for (const [size, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.screenshot({ path: join(directory, `${label}-${size}-${theme}.png`) });
    }
  }
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function chooseThroughUi(state: GameState, players: PlayerTab[]): Promise<string> {
  const { actor, choice } = chooseNext(state);
  const page = players.find((player) => player.id === actor)!.page;
  const choiceName = choice === actor ? "You" : players.find((player) => player.id === choice)!.name;
  const button = page.getByRole("button").filter({ hasText: choiceName }).filter({ hasText: "Play →" }).first();
  await button.click();
  return choice;
}

async function askThroughUi(state: GameState, players: PlayerTab[], playerId: string, ask: Ask): Promise<void> {
  const player = players.find((candidate) => candidate.id === playerId)!;
  const target = players.find((candidate) => candidate.id === ask.target)!;
  const page = player.page;
  const set = setOf(ask.card);
  await page.getByRole("radiogroup", { name: "Set to ask from" })
    .locator(`input[value="${set}"]`).check({ force: true });
  const cardGroup = page.getByRole("radiogroup", { name: /Pick a card you don’t have/ });
  await cardGroup.getByRole("img", { name: cardLabel(ask.card), exact: true }).click({ force: true });
  const targetGroup = page.getByRole("radiogroup", { name: /Pick an opponent/ });
  await targetGroup.getByRole("radio", { name: target.name, exact: true }).check({ force: true });
  await page.getByRole("button", { name: `Ask ${target.name} for ${cardLabel(ask.card)}`, exact: true }).click();
}

async function declareThroughUi(state: GameState, players: PlayerTab[], playerId: string, set: SetId): Promise<void> {
  const player = players.find((candidate) => candidate.id === playerId)!;
  const page = player.page;
  const team = state.players.find((seat) => seat.id === playerId)!.team;
  await page.getByRole("radiogroup", { name: "Action" })
    .getByRole("radio", { name: "Declare" }).check({ force: true });
  await page.getByRole("radiogroup", { name: "Set to declare" })
    .locator(`input[value="${set}"]`).check({ force: true });
  for (const card of cardsInSet(set)) {
    if (state.hands[playerId]!.includes(card)) continue;
    const owner = state.players.find((seat) => state.hands[seat.id]!.includes(card));
    if (!owner || owner.team !== team) throw new Error(`Declaration would be wrong for ${card}`);
    const group = page.getByRole("radiogroup", { name: `Who holds ${cardLabel(card)}`, exact: true });
    await group.getByRole("radio", { name: players.find((candidate) => candidate.id === owner.id)!.name, exact: true })
      .check({ force: true });
  }
  await page.getByRole("button", { name: "Review declaration", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function sendOneStrategicAction(state: GameState, players: PlayerTab[]): Promise<void> {
  if (state.phase.kind === "choose") {
    await chooseThroughUi(state, players);
    return;
  }
  if (state.phase.kind !== "turn") throw new Error("Expected a live turn");
  const player = state.phase.player;
  const team = state.players.find((seat) => seat.id === player)!.team;
  const set = findFullSet(state, team, player);
  if (set) {
    await declareThroughUi(state, players, player, set);
    await players.find((candidate) => candidate.id === player)!.page.getByRole("button", { name: "Declare set", exact: true }).click();
    return;
  }
  const ask = findAsk(state, player, false) ?? findAsk(state, player, true);
  if (!ask) throw new Error(`No legal ask for ${player}`);
  await askThroughUi(state, players, player, ask);
}

test("six players complete a game through the UI", async ({ browser, request }, testInfo) => {
  const players = await newPlayers(browser);
  try {
    const code = await createAndJoinRoom(players);
    await configureLobby(players);
    await captureVisual(testInfo, "lobby", players[0]!.page);
    await players[0]!.page.getByRole("button", { name: "Start game" }).click();

    let state = await gameState(request, code);
    await assertClients(state, players);
    expect(state.players.map((player) => player.team)).toEqual(["A", "B", "A", "B", "A", "B"]);
    expect(state.config.wrongDeclaration).toBe("award");
    const activePage = players.find((player) => player.id === (state.phase.kind === "turn" ? state.phase.player : ""))!;
    await captureVisual(testInfo, "my-turn", activePage.page);

    let failedAskSeen = false;
    let chooseSeen = false;
    let reviewSeen = false;
    for (let step = 0; state.phase.kind !== "over" && step < 150; step++) {
      const previous = JSON.stringify(state);
      if (state.phase.kind === "choose") {
        const { actor, choice } = chooseNext(state);
        if (!chooseSeen) {
          chooseSeen = true;
          await captureVisual(testInfo, "choose-phase", players.find((player) => player.id === actor)!.page);
        }
        const expected = await chooseThroughUi(state, players);
        expect(expected).toBe(choice);
      } else {
        const actor = state.phase.player;
        const team = state.players.find((seat) => seat.id === actor)!.team;
        const declaration = findFullSet(state, team, actor);
        if (declaration) {
          await declareThroughUi(state, players, actor, declaration);
          if (!reviewSeen) {
            reviewSeen = true;
            await captureVisual(testInfo, "declare-review", players.find((player) => player.id === actor)!.page);
          }
          await players.find((player) => player.id === actor)!.page.getByRole("button", { name: "Declare set", exact: true }).click();
        } else {
          const ask = findAsk(state, actor, !failedAskSeen) ?? findAsk(state, actor, true);
          if (!ask) throw new Error(`No legal ask for ${actor}`);
          await askThroughUi(state, players, actor, ask);
          if (!ask.succeeds && !failedAskSeen) {
            failedAskSeen = true;
            const asker = players.find((player) => player.id === actor)!.page;
            await expect(asker.getByText("Failed ask", { exact: true })).toBeVisible();
            await captureVisual(testInfo, "ask-spotlight", asker);
          }
        }
      }
      await expect.poll(async () => JSON.stringify(await gameState(request, code)), { timeout: 10_000 }).not.toBe(previous);
      state = await gameState(request, code);
      await assertClients(state, players);
      if (state.resolutions.length > 0) expect(state.resolutions.every((resolution) => resolution.correct)).toBe(true);
    }

    expect(state.phase.kind).toBe("over");
    expect(failedAskSeen).toBe(true);
    expect(chooseSeen).toBe(true);
    expect(reviewSeen).toBe(true);
    await captureVisual(testInfo, "game-over", players[0]!.page);
    await expect.poll(async () => {
      const response = await request.get(`${SERVER_URL}/api/stats`);
      const stats = await response.json() as { id: string; played: number }[];
      return PLAYER_NAMES.map((name) => stats.find((entry) => entry.id === `dev:${name}`)?.played ?? 0);
    }, { timeout: 10_000 }).toEqual(PLAYER_NAMES.map(() => 1));
  } finally {
    await Promise.all(players.map((player) => player.close()));
  }
});

test("reloading mid-game restores the player's seat and hand", async ({ browser, request }) => {
  const players = await newPlayers(browser);
  try {
    const code = await createAndJoinRoom(players);
    await configureLobby(players);
    await players[0]!.page.getByRole("button", { name: "Start game" }).click();
    let state = await gameState(request, code);
    await assertClients(state, players);

    const returning = players[1]!;
    const handBefore = (state.hands[returning.id] ?? []).map(cardLabel).sort();
    await returning.page.reload();
    await expect.poll(() => handLabels(returning.page).then((labels) => labels.sort()), { timeout: 15_000 }).toEqual(handBefore);
    expect(state.players.find((player) => player.id === returning.id)).toBeDefined();

    const previous = JSON.stringify(state);
    await sendOneStrategicAction(state, players);
    await expect.poll(async () => JSON.stringify(await gameState(request, code)), { timeout: 10_000 }).not.toBe(previous);
    state = await gameState(request, code);
    await assertClients(state, players);
  } finally {
    await Promise.all(players.map((player) => player.close()));
  }
});
