import type { ComponentType } from "react";
import { setApi, type Api } from "../lib/api.js";
import { setConnectionFactory } from "../net/useRoomConnection.js";
import { makeDevPanel } from "./DevPanel.js";
import { CODE, LEADERBOARD, LOBBY_SETUP, ME, P, makeRoom } from "./fixtures.js";
import { MockServer } from "./server.js";

/** Swaps the HTTP API and WebSocket for in-browser fakes; returns the dev panel to render. */
export function installMock(): ComponentType {
  const server = new MockServer();

  const api: Api = {
    me: async () => (server.loggedIn ? ME : null),
    createRoom: async () => {
      server.load(makeRoom({ status: "lobby", hostId: P.me, teams: LOBBY_SETUP, config: { turnSeconds: 60 } }));
      return { code: CODE };
    },
    logout: async () => {
      server.loggedIn = false;
    },
    stats: async () => LEADERBOARD,
    interceptLogin: async () => {
      server.loggedIn = true;
    },
  };

  setApi(api);
  setConnectionFactory((code, handlers) => server.connect(code, handlers));
  return makeDevPanel(server);
}
