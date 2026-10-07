import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ClientMessage, RoomPlayer } from "@litt/protocol";
import { Lobby, startProblem } from "../src/room/Lobby.js";
import { makeRoom, type RoomOptions } from "./fixtures.js";

function renderLobby(room = makeRoom({ status: "lobby", teams: { eve: null, frank: null } }), meId = "me") {
  const send = vi.fn<(msg: ClientMessage) => void>();
  render(
    <MemoryRouter>
      <Lobby room={room} meId={meId} send={send} />
    </MemoryRouter>,
  );
  return { send, room };
}

const lobbyRoom = (o: RoomOptions = {}) => makeRoom({ status: "lobby", ...o });
const player = (id: string, team: RoomPlayer["team"]): RoomPlayer => ({
  id,
  displayName: id,
  avatarUrl: null,
  team,
  connected: true,
});
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const radio = (name: string | RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;

describe("startProblem", () => {
  it("requires at least 6 players", () => {
    expect(startProblem([])).toMatch(/at least 6 players/i);
    expect(startProblem([player("a", "A"), player("b", "B"), player("c", "A"), player("d", "B")])).toMatch(/at least 6/i);
  });

  it("names everyone who is unassigned", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(startProblem(six.map((id, i) => player(id, i < 4 ? (i % 2 ? "B" : "A") : null)))).toBe("Assign e and f to a team.");
    expect(startProblem(six.map((id, i) => player(id, i === 0 ? null : "A")))).toBe("Assign a to a team.");
    expect(startProblem(six.map((id, i) => player(id, i < 3 ? null : "B")))).toBe("Assign a, b and c to a team.");
  });

  it("requires equal teams", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(startProblem(six.map((id, i) => player(id, i < 4 ? "A" : "B")))).toBe("Teams must be the same size.");
  });

  it("is empty when the game can start", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(startProblem(six.map((id, i) => player(id, i < 3 ? "A" : "B")))).toBe("");
  });
});

describe("Lobby as the host", () => {
  it("shows host controls and a disabled Start with the reason", () => {
    renderLobby();
    expect(button("Start game").disabled).toBe(true);
    expect(screen.getByText("Assign Eve and Frank to a team.")).toBeTruthy();
    expect(button("Randomize teams")).toBeTruthy();
    expect(screen.queryByText(/Waiting for .* to start/)).toBeNull();
    // Two move buttons for each of the 6 players.
    expect(screen.getAllByRole("button", { name: /^(Move|Unassign) .* (to|from) Team [AB]$/ })).toHaveLength(12);
  });

  it("enables config controls", () => {
    renderLobby();
    expect(radio("Nullify set").disabled).toBe(false);
    expect(radio("Award to opponents").checked).toBe(true);
    expect(button("More").disabled).toBe(false);
    expect(radio("60s").disabled).toBe(false);
  });

  it("shows the room code and invite link", () => {
    renderLobby();
    expect(screen.getByText("ROOM · K7QX")).toBeTruthy();
    expect(screen.getByText(`${window.location.host}/r/K7QX`)).toBeTruthy();
  });

  it("enables Start once there are 6 players on equal teams, and sends lobby.start", () => {
    const { send } = renderLobby(lobbyRoom());
    expect(button("Start game").disabled).toBe(false);
    fireEvent.click(button("Start game"));
    expect(send).toHaveBeenCalledWith({ t: "lobby.start" });
  });

  it.each<[string, RoomOptions, RegExp]>([
    ["too few players", { players: ["a", "b", "c", "d"].map((id, i) => player(id, i % 2 ? "B" : "A")) }, /Need at least 6 players/],
    ["an unassigned player", { teams: { eve: null } }, /Assign Eve to a team\./],
    ["unequal teams", { teams: { eve: "B" } }, /Teams must be the same size\./],
  ])("keeps Start disabled for %s", (_name, opts, reason) => {
    renderLobby(lobbyRoom(opts));
    expect(button("Start game").disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it("moves a player to a team, or unassigns them when pressing their current team", () => {
    const { send } = renderLobby();
    fireEvent.click(button("Move Eve to Team A"));
    expect(send).toHaveBeenLastCalledWith({ t: "lobby.setTeam", playerId: "eve", team: "A" });
    fireEvent.click(button("Move Maya to Team B"));
    expect(send).toHaveBeenLastCalledWith({ t: "lobby.setTeam", playerId: "maya", team: "B" });
    fireEvent.click(button("Unassign Maya from Team A"));
    expect(send).toHaveBeenLastCalledWith({ t: "lobby.setTeam", playerId: "maya", team: null });
  });

  it("randomizes into two equal teams with one lobby.setTeam per change", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const room = lobbyRoom({ teams: { me: null, bob: null, maya: null, priya: null, eve: null, frank: null } });
    const { send } = renderLobby(room);
    fireEvent.click(button("Randomize teams"));
    const teams = new Map<string, string | null>();
    for (const [msg] of send.mock.calls) {
      if (msg.t !== "lobby.setTeam") throw new Error("unexpected message");
      teams.set(msg.playerId, msg.team);
    }
    expect(teams.size).toBe(6);
    expect([...teams.values()].filter((t) => t === "A")).toHaveLength(3);
    expect([...teams.values()].filter((t) => t === "B")).toHaveLength(3);
  });

  it("sends the whole config when a rule changes", () => {
    const { send, room } = renderLobby();
    fireEvent.click(radio("Nullify set"));
    expect(send).toHaveBeenLastCalledWith({ t: "lobby.setConfig", config: { ...room.config, wrongDeclaration: "null" } });
    fireEvent.click(button("More"));
    expect(send).toHaveBeenLastCalledWith({ t: "lobby.setConfig", config: { ...room.config, historyLimit: 4 } });
    fireEvent.click(button("Fewer"));
    expect(send).toHaveBeenLastCalledWith({ t: "lobby.setConfig", config: { ...room.config, historyLimit: 2 } });
    fireEvent.click(radio("30s"));
    expect(send).toHaveBeenLastCalledWith({ t: "lobby.setConfig", config: { ...room.config, turnSeconds: 30 } });
  });

  it("can turn the timer off again", () => {
    const { send, room } = renderLobby(lobbyRoom({ config: { turnSeconds: 60 } }));
    expect(radio("60s").checked).toBe(true);
    fireEvent.click(radio("Off"));
    expect(send).toHaveBeenLastCalledWith({ t: "lobby.setConfig", config: { ...room.config, turnSeconds: null } });
  });

  it("limits the history stepper to 1–10", () => {
    renderLobby(lobbyRoom({ config: { historyLimit: 1 } }));
    expect(button("Fewer").disabled).toBe(true);
    expect(button("More").disabled).toBe(false);
  });

  it("limits the history stepper at 10", () => {
    renderLobby(lobbyRoom({ config: { historyLimit: 10 } }));
    expect(button("More").disabled).toBe(true);
  });

  it("copies the invite link and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderLobby();
    fireEvent.click(button("Copy invite"));
    expect(await screen.findByText("Copied ✓")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/r/K7QX`);
    await waitFor(() => expect(screen.getByText("Copied ✓")).toBeTruthy());
  });
});

describe("Lobby as a guest", () => {
  const guest = () => renderLobby(lobbyRoom({ hostId: "maya", teams: { eve: null, frank: null } }), "me");

  it("shows read-only controls and who we are waiting for", () => {
    guest();
    expect(screen.getByText("Waiting for Maya to start")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start game" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Randomize teams" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Move|Unassign) / })).toBeNull();
    expect(screen.getByText("The host is setting up teams.")).toBeTruthy();
  });

  it("disables every rule control", () => {
    guest();
    expect(radio("Nullify set").disabled).toBe(true);
    expect(radio("Award to opponents").disabled).toBe(true);
    expect(button("Fewer").disabled).toBe(true);
    expect(button("More").disabled).toBe(true);
    for (const t of ["Off", "15s", "30s", "60s", "120s"]) expect(radio(t).disabled).toBe(true);
  });

  it("shows no start reason, since only the host can act on it", () => {
    guest();
    expect(screen.queryByText(/Assign .* to a team/)).toBeNull();
  });

  it("still lists everyone on their team, with the host marked", () => {
    guest();
    expect(screen.getByText("♛ Host")).toBeTruthy();
    expect(screen.getByText("dharshen (you)")).toBeTruthy();
    expect(screen.getByText("Team A")).toBeTruthy();
    expect(screen.getByText("Unassigned")).toBeTruthy();
  });
});
