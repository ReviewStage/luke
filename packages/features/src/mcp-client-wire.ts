import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";

/**
 * mcp-client-wire.ts -- the outside MCP clients a member allowed into their account, as Settings › MCP lists and revokes them.
 *
 * An outside MCP client (Claude Code, Codex, Claude.ai, ChatGPT) signs a
 * member in to the member MCP server through the auth service, and the
 * member's Allow on the consent page is what it holds from then on, beside
 * the tokens minted on it. `/api/account/mcp-clients` answers the clients
 * the member allowed, every one but the desktop's own, with the server's address
 * a client is pointed at (GET); and revokes one by its client id named in
 * the query (DELETE): its tokens are deleted and its Allow with them, so its
 * next refresh is refused and its next sign-in asks again. An access token
 * it already holds is checked against the key set alone, so it keeps
 * working until it expires, `MCP_ACCESS_TOKEN_MINUTES` at most. Every
 * answer carries the clients as they then stand, so the page draws the
 * service's word; revoking one already gone answers the list as it stands.
 */

/** How long an access token for the member MCP server lives, in minutes: how long a client revoked may still call it on one it holds. */
export const MCP_ACCESS_TOKEN_MINUTES = 15;

/** The query a revoke names its client in. */
export const MCP_CLIENT_QUERY = {
  CLIENT_ID: "clientId",
} as const;

/** A client's id as the auth service holds one: a registration's own, or the address of its metadata document. */
export const mcpClientIdSchema = EffectSchema.NonEmptyString.check(EffectSchema.isMaxLength(2_048));

/** One client the member allowed, as they see it. */
const mcpClientSchema = EffectSchema.Struct({
  clientId: mcpClientIdSchema,
  /** The name it registered under; none where it gave none. */
  name: EffectSchema.NullOr(EffectSchema.String),
  /** Where it may send the member back to, as it registered them. */
  redirectUris: EffectSchema.Array(EffectSchema.String),
  /** When the member allowed it, in epoch milliseconds. */
  allowedAt: EffectSchema.NullOr(countedNumber),
  /** When it last traded a refresh token for a new one, in epoch milliseconds; none where it never has. */
  lastRefreshedAt: EffectSchema.NullOr(countedNumber),
});

export type McpClient = typeof mcpClientSchema.Type;

/** The clients the member allowed (GET, and every DELETE's answer), newest allowed first, with the server's address. */
export const mcpClientsAnswerSchema = EffectSchema.Struct({
  /** The member MCP server's address on this deployment, which a client is pointed at. */
  serverUrl: EffectSchema.String,
  clients: EffectSchema.Array(mcpClientSchema),
});

export type McpClientsAnswer = typeof mcpClientsAnswerSchema.Type;
