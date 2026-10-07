import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerStats, UserProfile } from "@litt/protocol";
import { ToastProvider } from "../src/components/Toasts.js";
import { setApi } from "../src/lib/api.js";
import { Home } from "../src/pages/Home.js";

const ME: UserProfile = { id: "u-me", displayName: "dharshen", avatarUrl: null };
const stat = (id: string, displayName: string, wins: number, losses: number, draws: number): PlayerStats => ({
  id,
  displayName,
  avatarUrl: null,
  played: wins + losses + draws,
  wins,
  losses,
  draws,
});
const STATS = [stat("u-priya", "Priya", 29, 20, 2), stat("u-me", "dharshen", 24, 14, 1), stat("u-new", "Newbie", 0, 0, 0)];

function RoomStub() {
  return <div>room {useParams().code}</div>;
}

const api = {
  me: vi.fn<() => Promise<UserProfile | null>>(),
  createRoom: vi.fn<() => Promise<{ code: string }>>(),
  logout: vi.fn<() => Promise<void>>(),
  stats: vi.fn<() => Promise<PlayerStats[]>>(),
};

function renderHome() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/r/:code" element={<RoomStub />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.me.mockResolvedValue(ME);
  api.createRoom.mockResolvedValue({ code: "ZZZZ" });
  api.logout.mockResolvedValue(undefined);
  api.stats.mockResolvedValue(STATS);
  setApi(api);
});

describe("Home: logged out", () => {
  beforeEach(() => api.me.mockResolvedValue(null));

  it("offers Discord login that returns to the current path, and no room controls", async () => {
    renderHome();
    const link = await screen.findByRole("link", { name: /Log in with Discord/ });
    expect(link.getAttribute("href")).toBe("/auth/login?next=%2F");
    expect(screen.queryByRole("button", { name: "Create room" })).toBeNull();
    expect(screen.queryByLabelText("Room code")).toBeNull();
  });

  it("still shows the leaderboard", async () => {
    renderHome();
    expect(await screen.findByText("Priya")).toBeTruthy();
  });
});

describe("Home: logged in", () => {
  it("shows the profile and a logout button", async () => {
    renderHome();
    await screen.findByRole("button", { name: "Create room" });
    expect(screen.getByText("Signed in with Discord")).toBeTruthy();
    expect(screen.getAllByText("dharshen").length).toBeGreaterThan(0);
  });

  it("creates a room and goes to it", async () => {
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: "Create room" }));
    expect(await screen.findByText("room ZZZZ")).toBeTruthy();
  });

  it("shows an error toast when the room can't be created", async () => {
    api.createRoom.mockRejectedValue(new Error("boom"));
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: "Create room" }));
    expect(await screen.findByText(/Couldn’t create a room/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create room" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("upper-cases the room code, and only enables Join from 4 characters", async () => {
    renderHome();
    const input = (await screen.findByLabelText("Room code")) as HTMLInputElement;
    const join = screen.getByRole("button", { name: "Join" }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "ab-c" } });
    expect(input.value).toBe("ABC");
    expect(join.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "k7qx" } });
    expect(input.value).toBe("K7QX");
    expect(join.disabled).toBe(false);
  });

  it("joins the room by code", async () => {
    renderHome();
    fireEvent.change(await screen.findByLabelText("Room code"), { target: { value: "k7qx" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText("room K7QX")).toBeTruthy();
  });

  it("logs out", async () => {
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));
    expect(api.logout).toHaveBeenCalled();
    expect(await screen.findByRole("link", { name: /Log in with Discord/ })).toBeTruthy();
  });
});

describe("Home: leaderboard", () => {
  it("lists players in the server's order with W · L · D and win rate", async () => {
    renderHome();
    await screen.findByText("Priya");
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Priya");
    expect(rows[0]!.textContent).toContain("51 played");
    expect(rows[0]!.textContent).toContain("29 · 20 · 2");
    expect(rows[0]!.textContent).toContain("57%");
    expect(rows[1]!.textContent).toContain("24 · 14 · 1");
    expect(rows[1]!.textContent).toContain("62%");
  });

  it("highlights me, and shows a dash for someone with no games", async () => {
    renderHome();
    await screen.findByText("Newbie");
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows[1]!.querySelector("[data-me]")).not.toBeNull();
    expect(rows[0]!.querySelector("[data-me]")).toBeNull();
    expect(rows[2]!.textContent).toContain("—");
  });

  it("says so when nobody has played yet", async () => {
    api.stats.mockResolvedValue([]);
    renderHome();
    expect(await screen.findByText("No games played yet. Be the first.")).toBeTruthy();
  });

  it("copes with the stats request failing", async () => {
    api.stats.mockRejectedValue(new Error("down"));
    renderHome();
    expect(await screen.findByText("No games played yet. Be the first.")).toBeTruthy();
  });

  it("treats a failed /api/me as logged out", async () => {
    api.me.mockRejectedValue(new Error("down"));
    renderHome();
    await waitFor(() => expect(screen.getByRole("link", { name: /Log in with Discord/ })).toBeTruthy());
  });
});

describe("Home: dev login (dev builds only)", () => {
  it("stores the name for this tab and reloads the profile", async () => {
    renderHome();
    const input = (await screen.findByLabelText("Dev login name")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(window.sessionStorage.getItem("litt_dev_user")).toBe("alice");
    await waitFor(() => expect(api.me.mock.calls.length).toBeGreaterThan(1));
  });

  it("rejects names the server wouldn't accept", async () => {
    renderHome();
    const input = (await screen.findByLabelText("Dev login name")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "bad name!" } });
    expect((screen.getByRole("button", { name: "Use" }) as HTMLButtonElement).disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});
