import { Schema as EffectSchema } from "effect";
import { mcpClientIdSchema, mcpClientsAnswerSchema } from "./mcp-client-wire.js";

export const MCP_CLIENTS_CALL_FAILURE = {
  UNANSWERED: "unanswered",
} as const;

export type McpClientsCallFailure =
  (typeof MCP_CLIENTS_CALL_FAILURE)[keyof typeof MCP_CLIENTS_CALL_FAILURE];

export const mcpClientsViewSchema = EffectSchema.Union([
  mcpClientsAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literals(Object.values(MCP_CLIENTS_CALL_FAILURE)) }),
]);

export type McpClientsView = typeof mcpClientsViewSchema.Type;

export const mcpClientRevokeParamsSchema = EffectSchema.Struct({ clientId: mcpClientIdSchema });

export type McpClientRevokeParams = typeof mcpClientRevokeParamsSchema.Type;
