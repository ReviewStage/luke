/**
 * mcp-app-wire.ts -- an agent's integration tool's MCP App, as the service answers it: its HTML, and the calls the app makes of its own server.
 *
 * Under the MCP Apps extension (modelcontextprotocol.io/docs/extensions/apps)
 * a tool may name a `ui://` resource, HTML its server serves, which a host
 * draws in a sandboxed frame beside the tool's call and speaks to over
 * `postMessage`. The service reads that HTML from the provider on the
 * agent's starter's grant when a window asks, and keeps it nowhere: the
 * transcript holds the call, never the app. What the resource's own
 * `_meta.ui` asks of the host (the domains its policy may name, the
 * permissions it wants, whether it wants a border) travels as the server
 * sent it, a record nothing on this side reads yet.
 *
 * An app may call a tool of its own server, which the window forwards to the
 * service by name with its arguments; the answer is the server's own MCP
 * result, its refusal an MCP error result, as an agent's call of the tool
 * reads it.
 */

import { WireRecordShapeSchema } from "@luke/wire";
import { Schema as EffectSchema } from "effect";

/** One tool's MCP App as its server serves it: its HTML, and the resource's `_meta.ui`, where it carried one. */
export const agentToolAppAnswerSchema = EffectSchema.Struct({
  html: EffectSchema.String,
  ui: EffectSchema.optionalKey(WireRecordShapeSchema),
});

export type AgentToolAppAnswer = typeof agentToolAppAnswerSchema.Type;

/** A call an app asks of its own server: the tool by name, and its arguments. */
export const agentToolAppCallRequestSchema = EffectSchema.Struct({
  name: EffectSchema.NonEmptyString,
  arguments: EffectSchema.optionalKey(WireRecordShapeSchema),
});

/** What the server answered the app's call: its MCP `CallToolResult`, whole. */
export const agentToolAppCallAnswerSchema = EffectSchema.Struct({
  result: WireRecordShapeSchema,
});
