/**
 * tools.ts -- the Luke tools a native harness's agent is served over MCP, each by its eve tool's own schema and door.
 *
 * A Claude Code or Codex agent keeps its harness's own shell, files, todos,
 * and subagents; what touches Luke reaches it as an MCP tool of Luke's own
 * server (`app.ts`). Each tool here is the one the agent's eve tool file
 * declares (`apps/dev/tools/<name>.ts`): the same name, the same description,
 * the same input schema, and the same door the coder host's method for it
 * runs (`../coder-host/inbox-door.ts` for the inbox), so the two runtimes run
 * one implementation. A door is reached directly rather than through the
 * coder host, because the host composes eve's sandbox and tools, which the
 * web function serving this server does not bundle. The registry maps a tool's name to those
 * three and nothing else, so serving another tool is one entry.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { INBOX_TOOL } from "@luke/features/inbox-wire";
import { ACTION_RESULT_STATUS, type UnparsedWireValue } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { type Effect, Schema } from "effect";
import type { HttpClient } from "effect/http";
import type { GitHubApp } from "../../github/github-app.js";
import type { WorkspaceLinearConnect } from "../../integrations/integration-connect.js";
import type { ModelCatalog } from "../../providers/model-catalog.js";
import { PICTURE_LOOK_STATUS } from "../../tasks/picture-look.js";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import { INBOX_TOOLS } from "../coder-host/inbox.js";
import { runAgentInbox } from "../coder-host/inbox-door.js";
import { RUN_ON_MAC_TOOL, runOnMacTool } from "../mac-command.js";

/** What a door answers: the tool's own result, the value its eve tool hands the model. */
export type LukeMcpToolResult = { readonly status?: string } & object;

/** What the doors run against, every one of which a web function's runtime provides. */
export type LukeMcpServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | ModelCatalog
  | WorkspaceLinearConnect;

/** One block of an MCP tool result: text, or an image as base64 with its type. */
export type McpContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

/** One tool as the server offers and runs it. */
export interface LukeMcpTool {
  readonly description: string;
  /** The input schema as JSON Schema, emitted from the eve tool's own. */
  readonly inputSchema: object;
  /** Runs one call through the tool's door, as the agent's admitted conversation. */
  readonly run: (
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
  ) => Effect.Effect<LukeMcpToolResult, unknown, LukeMcpServices>;
  /** How a result is shown to the agent, where it is more than its JSON: a picture as an image. */
  readonly content?: (result: LukeMcpToolResult) => readonly McpContent[];
}

/** A tool as its eve file declares it: its name, its words, and its input schema. */
interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.Top;
}

function entry(
  spec: ToolSpec,
  run: LukeMcpTool["run"],
  content?: LukeMcpTool["content"],
): readonly [string, LukeMcpTool] {
  const tool: LukeMcpTool = {
    description: spec.description,
    inputSchema: emitJsonSchema(spec.inputSchema),
    run,
    ...(content === undefined ? {} : { content }),
  };
  return [spec.name, tool];
}

/** A look that answered a picture: its bytes as base64 and their type. */
const isLooked = Schema.is(
  Schema.Struct({
    status: Schema.Literal(PICTURE_LOOK_STATUS.LOOKED),
    image: Schema.String,
    mediaType: Schema.String,
  }),
);

/** What the agent is shown of a look: the picture itself, as an image, where it looked; its JSON otherwise. */
export function lookedPictureContent(result: LukeMcpToolResult): readonly McpContent[] {
  if (isLooked(result)) {
    return [
      { type: "text", text: "The picture you asked to see:" },
      { type: "image", data: result.image, mimeType: result.mediaType },
    ];
  }
  return [{ type: "text", text: JSON.stringify(result) }];
}

/** The tools served, by name, in the order `tools/list` names them. */
export const LUKE_MCP_TOOLS: ReadonlyMap<string, LukeMcpTool> = new Map<string, LukeMcpTool>([
  // The inbox. Posting waits on a door to the agent's sandbox, which the server has none of yet.
  entry(INBOX_TOOLS.READ, (admitted, input) =>
    runAgentInbox(admitted, { tool: INBOX_TOOL.READ, input }),
  ),
  entry(INBOX_TOOLS.WITHDRAW, (admitted, input) =>
    runAgentInbox(admitted, { tool: INBOX_TOOL.WITHDRAW, input }),
  ),
  // The developer's Mac.
  entry(RUN_ON_MAC_TOOL, (admitted, input) => runOnMacTool(admitted.target.userId, input)),
]);

/** The prefix of every status a door answers for a call it did not carry out (`not-run`, `not-looked`, `not-saved`, …). */
const NOT_DONE_PREFIX = "not-";

/** The statuses a door answers for a call it refused outright. */
const REFUSED_STATUSES: ReadonlySet<string> = new Set([
  ACTION_RESULT_STATUS.REJECTED,
  ACTION_RESULT_STATUS.UNSUPPORTED,
]);

/** Whether a door's answer is its refusal, which the server answers as a tool error the agent reads. */
export function refusedByDoor(result: LukeMcpToolResult): boolean {
  const { status } = result;
  return (
    status !== undefined && (REFUSED_STATUSES.has(status) || status.startsWith(NOT_DONE_PREFIX))
  );
}
