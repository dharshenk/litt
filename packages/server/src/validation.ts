import { isCard, isSetId, type Card, type SetId } from "@litt/engine";
import type { ClientMessage } from "@litt/protocol";
import { z } from "zod";

const cardSchema = z.custom<Card>(isCard, "Unknown card");
const setSchema = z.custom<SetId>(isSetId, "Unknown set");
const teamSchema = z.enum(["A", "B"]);

export const roomConfigSchema = z.object({
  wrongDeclaration: z.enum(["award", "null"]),
  historyLimit: z.number().int().min(1).max(10),
  turnSeconds: z.number().int().min(15).max(600).nullable(),
}).strict();

export const clientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("lobby.setTeam"), playerId: z.string(), team: teamSchema.nullable() }).strict(),
  z.object({ t: z.literal("lobby.setConfig"), config: roomConfigSchema }).strict(),
  z.object({ t: z.literal("lobby.start") }).strict(),
  z.object({ t: z.literal("room.rematch") }).strict(),
  z.object({ t: z.literal("game.ask"), target: z.string(), card: cardSchema }).strict(),
  z.object({ t: z.literal("game.declare"), set: setSchema, assignment: z.record(cardSchema, z.string()) }).strict(),
  z.object({ t: z.literal("game.choose"), player: z.string() }).strict(),
  z.object({ t: z.literal("ping") }).strict(),
]);

type Assert<Condition extends true> = Condition;
export type SchemaMatchesProtocol = Assert<z.output<typeof clientMessageSchema> extends ClientMessage ? true : false>;
export type ProtocolMatchesSchema = Assert<ClientMessage extends z.output<typeof clientMessageSchema> ? true : false>;

export function parseClientMessage(raw: string):
  | { ok: true; msg: ClientMessage }
  | { ok: false; error: string } {
  if (new TextEncoder().encode(raw).byteLength > 16 * 1024) {
    return { ok: false, error: "Message exceeds 16 KB" };
  }
  try {
    const result = clientMessageSchema.safeParse(JSON.parse(raw));
    return result.success
      ? { ok: true, msg: result.data }
      : { ok: false, error: result.error.message };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}