import { Schema as EffectSchema } from "effect";
import { mcpClientIdSchema, mcpClientsAnswerSchema } from "./mcp-client-wire.js";

/**
 * mcp-client-view.ts -- the outside MCP clients the account allowed, as the window asks the host for them and hears back.
 *
 * Every answer is the clients as the service then holds them, or why there
 * is none: a revoke that did not finish answers that, never the list it
 * would have left, so a client whose revoke failed still stands on the page
 * with its Revoke.
 */

/** Why a read or a revoke has no answer: the service never gave one the window can draw. */
export const MCP_CLIENTS_CALL_FAILURE = {
  UNANSWERED: "unanswered",
} as const;

export type McpClientsCallFailure =
  (typeof MCP_CLIENTS_CALL_FAILURE)[keyof typeof MCP_CLIENTS_CALL_FAILURE];

/** The clients as the window hears them read or one revoked: the clients as they stand, or why there are none. */
export const mcpClientsViewSchema = EffectSchema.Union([
  mcpClientsAnswerSchema,
  EffectSchema.Struct({ failure: EffectSchema.Literals(Object.values(MCP_CLIENTS_CALL_FAILURE)) }),
]);

export type McpClientsView = typeof mcpClientsViewSchema.Type;

/** Revoking a client, as the window asks it: the client's id. */
export const mcpClientRevokeParamsSchema = EffectSchema.Struct({ clientId: mcpClientIdSchema });

export type McpClientRevokeParams = typeof mcpClientRevokeParamsSchema.Type;
