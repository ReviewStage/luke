import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";

export const MCP_ACCESS_TOKEN_MINUTES = 15;

export const MCP_CLIENT_QUERY = {
  CLIENT_ID: "clientId",
} as const;

export const mcpClientIdSchema = EffectSchema.NonEmptyString.check(EffectSchema.isMaxLength(2_048));

const mcpClientSchema = EffectSchema.Struct({
  clientId: mcpClientIdSchema,
  name: EffectSchema.NullOr(EffectSchema.String),
  redirectUris: EffectSchema.Array(EffectSchema.String),
  allowedAt: EffectSchema.NullOr(countedNumber),
  lastRefreshedAt: EffectSchema.NullOr(countedNumber),
});

export type McpClient = typeof mcpClientSchema.Type;

export const mcpClientsAnswerSchema = EffectSchema.Struct({
  serverUrl: EffectSchema.String,
  clients: EffectSchema.Array(mcpClientSchema),
});

export type McpClientsAnswer = typeof mcpClientsAnswerSchema.Type;
