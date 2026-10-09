import type { Rng } from "@litt/engine";
import type { Room, RoomDeps } from "./room.js";
import { secureRandom } from "./security.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_COUNT = ALPHABET.length ** 4;
const IDLE_MS = 30 * 60 * 1000;
/** Bounds memory and keeps codes sparse enough that guessing one is impractical. */
const MAX_ROOMS = 5_000;

export interface RoomRegistryOptions {
  factory(code: string, hostId: string, onConnectionsChanged: () => void): Room;
  setTimer: RoomDeps["setTimer"];
  rng?: Rng;
  maxRooms?: number;
}

interface Entry {
  room: Room;
  cancelIdle: (() => void) | null;
  idleVersion: number;
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Entry>();

  constructor(private readonly options: RoomRegistryOptions) {}

  create(hostId: string): string {
    if (this.rooms.size >= Math.min(CODE_COUNT, this.options.maxRooms ?? MAX_ROOMS)) throw new Error("No room codes available");
    let value = Math.floor((this.options.rng ?? secureRandom)() * CODE_COUNT);
    let code = this.codeFor(value);
    while (this.rooms.has(code)) {
      value = (value + 1) % CODE_COUNT;
      code = this.codeFor(value);
    }
    const room = this.options.factory(code, hostId, () => { this.updateIdle(code); });
    this.rooms.set(code, { room, cancelIdle: null, idleVersion: 0 });
    this.updateIdle(code);
    return code;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code)?.room;
  }

  dispose(): void {
    const entries = [...this.rooms.values()];
    this.rooms.clear();
    for (const entry of entries) {
      entry.cancelIdle?.();
      entry.room.dispose();
    }
  }

  private codeFor(value: number): string {
    let code = "";
    for (let index = 0; index < 4; index++) {
      code = ALPHABET[value % ALPHABET.length]! + code;
      value = Math.floor(value / ALPHABET.length);
    }
    return code;
  }

  private updateIdle(code: string): void {
    const entry = this.rooms.get(code);
    if (!entry) return;
    if (entry.room.connectedCount() > 0) {
      entry.cancelIdle?.();
      entry.cancelIdle = null;
      entry.idleVersion++;
    } else if (!entry.cancelIdle) {
      const version = ++entry.idleVersion;
      entry.cancelIdle = this.options.setTimer(IDLE_MS, () => {
        if (entry.room.connectedCount() !== 0 || entry.idleVersion !== version || this.rooms.get(code) !== entry) return;
        this.rooms.delete(code);
        entry.room.dispose();
      });
    }
  }
}
