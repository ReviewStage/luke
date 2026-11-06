/**
 * catalog.ts -- every tool of ours an agent is served, declared once: its words, its schema, its gate, and its door.
 *
 * Claude Code and Codex keep their harness's own shell, files, todos, and
 * subagents; what touches the app reaches the agent as a tool of our MCP
 * server (`../workspace-mcp/app.ts`), and this catalog is that server's
 * every tool. Each is declared once here: the name, the description, and
 * the input schema its tool file declares; the gate it stands behind, if
 * any (`gates.ts`); whether Claude Code loads it from the first turn; the
 * door it runs through (`../coder-host/inbox-door.ts` for the inbox,
 * `../coder-host/agent-doors.ts` for the rest); and, for the tools whose
 * answer is a picture, how it is shown. A door is reached directly rather
 * than through the coder host, because the host composes eve's sandbox and
 * tools, which the web function serving the server does not bundle.
 *
 * What an agent is offered is read from here alone (`offeredTools`): the
 * server's `tools/list` and the agent's MCP popover both ask it, so neither
 * can name a tool the other does not. A tool left off an agent's list is
 * still refused by its door where a harness calls it anyway.
 *
 * `browser` drives the Chromium in the agent's own sandbox, found by the
 * session the sandbox is tagged with (`admitted.runtimeSessionId`), as eve's
 * tool finds it, its tabs kept under the agent's own conversation; its
 * screenshots reach the agent as images, which the transcript leaves out.
 *
 * Left out, beside the harness's own shell, files, todos, waiting,
 * subagents, skills, and web reads: eve's `connection_search` and
 * `connection_execute`, since each integration the agent is handed is an
 * MCP server of its own beside ours (`../workspace-mcp/app.ts`).
 *
 * Two things eve's tool files keep in the session's own state are kept
 * otherwise here, since the server keeps no session: a call's id, which the
 * agent tools key a start or a message on, is the key the store holds for the
 * agent's conversation, the tool, and the input within a window
 * (`../workspace-mcp/call-key.ts`), so the call a harness retries after a
 * timeout starts or sends once, as eve's run again does; and the turn's
 * count of description notes is kept on the running turn's row in the store
 * (`runTurnCappedEditDescription`), so the cap holds per turn as eve's does.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  reserveTurnDescriptionNotes,
  settleTurnDescriptionNotes,
} from "@repo/database/models/agent-store";
import { INBOX_TOOL } from "@repo/features/inbox-wire";
import { pictureTypeSchema } from "@repo/features/picture-wire";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { emitJsonSchema } from "@repo/wire/effect";
import { Effect, Exit, Option, Schema } from "effect";
import type { HttpClient } from "effect/http";
import type { HostedEnvironment } from "../../environment.js";
import type { GitHubApp } from "../../github/github-app.js";
import { logStoreFailure } from "../../http/store-failure.js";
import type { IntegrationConnect } from "../../integrations/integration-connect.js";
import type { ModelCatalog } from "../../providers/model-catalog.js";
import {
  type CommentToolName,
  READ_COMMENTS_TOOL,
  REPLY_TO_COMMENT_TOOL,
  UPDATE_COMMENT_TOOL,
} from "../../tasks/comment-tools.js";
import { CODER_SHOW_PAGE_TOOL } from "../../tasks/page-tool.js";
import {
  LOOK_AT_PICTURE_TOOL,
  lookNamedOnly,
  PICTURE_LOOK_STATUS,
} from "../../tasks/picture-look.js";
import type { SentryApp } from "../../triggers/sentry/sentry-app-config.js";
import {
  CODER_READ_AGENT_TOOL,
  LIST_AGENTS_TOOL,
  LIST_MODELS_TOOL,
  LIST_TASKS_TOOL,
  READ_PAGE_TOOL,
  START_AGENT_TOOL,
  STOP_AGENT_TOOL,
  UPDATE_AGENT_TOOL,
  UPDATE_TASK_TOOL,
} from "../agent-tools.js";
import {
  CREATE_AUTOMATION_TOOL,
  DELETE_AUTOMATION_TOOL,
  LIST_AUTOMATIONS_TOOL,
  RUN_AUTOMATION_TOOL,
  UPDATE_AUTOMATION_TOOL,
} from "../automation-tools.js";
import type { AgentBrowser } from "../browser/agent-browser.js";
import {
  BROWSER_TOOL,
  BROWSER_TOOL_REFUSAL,
  browserModelOutput,
  browserNotRun,
  runBrowserTool,
  storedBrowserOutput,
} from "../browser/browser-tool.js";
import {
  type AgentDoorSeams,
  type AgentToolCall,
  runAgentComment,
  runAgentEditDescription,
  runAgentLookAtPicture,
  runAgentOpenPullRequest,
  runAgentShowImage,
  runAgentShowPage,
  runAgentTools,
} from "../coder-host/agent-doors.js";
import { MESSAGE_AGENT_TOOL } from "../coder-host/agent-message.js";
import {
  DESCRIPTION_EDIT_REFUSAL,
  descriptionEditRejected,
  EDIT_DESCRIPTION_TOOL,
  requestedNotes,
} from "../coder-host/description-edit.js";
import { INBOX_TOOLS } from "../coder-host/inbox.js";
import { runAgentInbox } from "../coder-host/inbox-door.js";
import type { InboxSandboxDoor } from "../coder-host/inbox-image.js";
import { OPEN_PULL_REQUEST_TOOL } from "../coder-host/pull-request.js";
import { SHOW_IMAGE_TOOL } from "../coder-host/show-image.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { RUN_ON_MAC_TOOL, runOnMacTool } from "../mac-command.js";
import { SAVE_MEMORY_TOOL, SEARCH_MEMORY_TOOL } from "../memory-tools.js";
import { CREATE_SECTION_TOOL, DELETE_SECTION_TOOL } from "../task-section-tools.js";
import { CREATE_TASK_TOOL, READ_TASK_TOOL } from "../task-tools.js";
import { type AgentStanding, TOOL_GATE, type ToolGate } from "./gates.js";

/** What a door answers: the tool's own result, the value its eve tool hands the model. */
export type WorkspaceMcpToolResult = { readonly status?: string } & object;

/** What the doors run against, every one of which a web function's runtime provides. */
export type WorkspaceMcpServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | ModelCatalog
  | IntegrationConnect
  | HostedEnvironment
  | SentryApp;

/** What a tool runs against: the doors' services, and the agent's browser, which the server provides itself (`../workspace-mcp/app.ts`). */
type WorkspaceMcpToolServices = WorkspaceMcpServices | AgentBrowser;

/** What a call carries beside its input: the door to the agent's sandbox, where a tool reads a file the agent names by its path; the key it runs under, read from the store by the tools that key a row on it (`../workspace-mcp/call-key.ts`); and the seams the doors that reach eve or the store's writer read. */
interface WorkspaceMcpCallContext {
  readonly sandbox: InboxSandboxDoor;
  readonly callKey: Effect.Effect<string, StoreFailure, DatabaseServices>;
  readonly seams: AgentDoorSeams;
}

/** One block of an MCP tool result: text, or an image or a sound as base64 with its type. */
export type McpContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image" | "audio"; readonly data: string; readonly mimeType: string };

/** Runs one call through a tool's door, as the agent's admitted conversation. */
type Door = (
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  context: WorkspaceMcpCallContext,
) => Effect.Effect<WorkspaceMcpToolResult, unknown, WorkspaceMcpToolServices>;

/** One tool as the catalog declares it. */
export interface CatalogTool<Name extends string = string> {
  readonly name: Name;
  readonly description: string;
  /** The input schema as JSON Schema, emitted from the tool file's own. */
  readonly inputSchema: object;
  /** The gate the tool stands behind; a tool with none is offered every agent. */
  readonly gate?: ToolGate;
  /**
   * Whether Claude Code lists it in its prompt from the first turn rather
   * than deferring it behind its tool search, where the first call of each
   * costs a `ToolSearch` step first. Note that every tool loaded so costs its
   * definition on every turn, so the rarely called ones (`look_at_picture`,
   * the automations, the sections) stay deferred.
   */
  readonly alwaysLoad?: true;
  readonly run: Door;
  /** How a result is shown to the agent, where it is more than its JSON: a picture as an image. */
  readonly content?: (result: WorkspaceMcpToolResult) => readonly McpContent[];
}

/** A tool as its tool file declares it: its name, its words, and its input schema. */
interface ToolSpec<Name extends string> {
  readonly name: Name;
  readonly description: string;
  readonly inputSchema: Schema.Top;
}

/** What of a tool the catalog declares beside its spec and its door. */
type Served = Pick<CatalogTool, "gate" | "alwaysLoad" | "content">;

function served<const Name extends string>(
  spec: ToolSpec<Name>,
  run: Door,
  options: Served = {},
): CatalogTool<Name> {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: emitJsonSchema(spec.inputSchema),
    run,
    ...options,
  };
}

/** A tool about the workspace's agents and tasks, run through their one door under the call's key. */
function agentTool<const Name extends AgentToolCall["tool"]>(
  spec: ToolSpec<Name>,
  options?: Served,
) {
  const run: Door = (admitted, input, { seams, callKey }) =>
    Effect.flatMap(callKey, (callId) =>
      runAgentTools(seams, admitted, { tool: spec.name, input, callId }),
    );
  return served(spec, run, options);
}

/** A tool of the description's comment threads, run through the comment door. */
function commentTool<const Name extends CommentToolName>(spec: ToolSpec<Name>) {
  return served(spec, (admitted, input) => runAgentComment(admitted, spec.name, input));
}

/** A look that answered a picture: its bytes as base64 and an image's type, never a video's, which no model is handed. */
const isLooked = Schema.is(
  Schema.Struct({
    status: Schema.Literal(PICTURE_LOOK_STATUS.LOOKED),
    image: Schema.String,
    mediaType: pictureTypeSchema,
  }),
);

/**
 * A look's text block where it looked: its status alone, as JSON. Note that
 * the transcript keeps the text blocks of a tool of ours alone
 * (`../native-events/claude-code-moments.ts`), so this is what a look is
 * stored as, the same as eve's relay stores one (`storedPictureLookOutput`).
 */
const LOOKED_TEXT: McpContent = {
  type: "text",
  text: JSON.stringify({ status: PICTURE_LOOK_STATUS.LOOKED }),
};

/** What the agent is shown of a look: its status and the picture itself, as an image, where it looked; its JSON otherwise. */
function lookedPictureContent(result: WorkspaceMcpToolResult): readonly McpContent[] {
  if (isLooked(result)) {
    return [LOOKED_TEXT, { type: "image", data: result.image, mimeType: result.mediaType }];
  }
  return [{ type: "text", text: JSON.stringify(lookNamedOnly(unparsedWire(result))) }];
}

/**
 * What the agent is shown of a browser call: its JSON with every
 * screenshot's base64 taken out and its kept full-size copy named by id
 * (`storedBrowserOutput`) as one text block, then each screenshot's
 * bounded copy as an image, in the order its steps name them. Note
 * that no caption stands between them, because the native transcript joins
 * the text blocks of a tool of ours and reads them as one JSON value
 * (`../native-events/runner-moments.ts`), so the one block keeps the result
 * whole there, the kept copies' ids among it for the window to draw.
 */
function browserContent(result: WorkspaceMcpToolResult): readonly McpContent[] {
  const output = unparsedWire(result);
  const shown = browserModelOutput(output);
  const text: McpContent = { type: "text", text: JSON.stringify(storedBrowserOutput(output)) };
  if (shown.type !== "content") return [text];
  const images = shown.value.flatMap((part): readonly McpContent[] =>
    part.type === "file" && part.data.type === "data" && typeof part.data.data === "string"
      ? [{ type: "image", data: part.data.data, mimeType: part.mediaType }]
      : [],
  );
  return [text, ...images];
}

/**
 * One `browser` call on the Chromium in the agent's own sandbox: the
 * sandbox tagged with the conversation's session, which is up, since the
 * agent calling runs in it. A conversation that records no session has no
 * sandbox to find, and runs nothing.
 */
function runAgentBrowser(admitted: AdmittedConversation, input: UnparsedWireValue) {
  const session = admitted.runtimeSessionId;
  if (session === undefined) return Effect.succeed(browserNotRun(BROWSER_TOOL_REFUSAL.NO_SANDBOX));
  const call = {
    browserSession: session,
    conversationId: admitted.target.conversationId,
    // Note that the native transcript is the conversation's own, so its screenshots are kept beside it.
    transcript: admitted.target,
    openSandbox: () => Promise.resolve(),
  };
  return runBrowserTool(call, input);
}

/**
 * One `edit_description` call under the turn's cap: its notes reserved against the
 * conversation's running turn in the store, the count before them handed to
 * the door as eve hands its session's, and the reservation settled to what
 * was taken once the door answers. A call that asks for notes before the
 * runner's events have recorded its turn is refused, to be tried again,
 * since there is no count yet to hold it to; one that asks for none has
 * nothing to count, and reaches the door. Note that the settle is the
 * reservation's release, because a call interrupted mid-save, by a Stop or a
 * request gone away, must not leave notes never taken counted for the rest
 * of the turn; the door itself stays interruptible, since its read of the
 * sandbox waits on no bound of its own. An interrupted call gives its whole
 * reservation back: a save it cut short rolls back, and one that had just
 * committed goes uncounted, which costs the cap one call's notes at most.
 * And a settle that fails is logged and the door's answer stands, because
 * the notes are saved by then and a retry would take them twice, so the
 * turn only counts the reservation whole.
 */
function runTurnCappedEditDescription(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
) {
  const { userId, conversationId } = admitted.target;
  const requested = requestedNotes(input);
  return Effect.acquireUseRelease(
    reserveTurnDescriptionNotes(userId, conversationId, requested),
    (turn) => {
      if (Option.isSome(turn)) {
        return runAgentEditDescription(admitted, input, turn.value.taken - requested, sandbox);
      }
      return requested > 0
        ? Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.NO_TURN))
        : runAgentEditDescription(admitted, input, 0, sandbox);
    },
    (turn, exit) => {
      if (Option.isNone(turn)) return Effect.void;
      const answer = Exit.isSuccess(exit) ? exit.value : undefined;
      const saved = answer?.status === ACTION_RESULT_STATUS.ACCEPTED ? answer.taken : 0;
      return settleTurnDescriptionNotes(userId, turn.value.turnId, requested, saved).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      );
    },
  ).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.UNAVAILABLE)),
    ),
  );
}

/** Loaded from the first turn (`CatalogTool`'s `alwaysLoad`). */
const LOADED: Served = { alwaysLoad: true };

/** Every tool served, in the order `tools/list` names them. */
const CATALOG = [
  // The threads, posted to the inbox.
  served(
    INBOX_TOOLS.POST,
    (admitted, input, { sandbox }) =>
      runAgentInbox(admitted, { tool: INBOX_TOOL.POST, input, sandbox }),
    LOADED,
  ),
  served(
    INBOX_TOOLS.READ,
    (admitted, input) => runAgentInbox(admitted, { tool: INBOX_TOOL.READ, input }),
    LOADED,
  ),
  served(
    INBOX_TOOLS.WITHDRAW,
    (admitted, input) => runAgentInbox(admitted, { tool: INBOX_TOOL.WITHDRAW, input }),
    LOADED,
  ),
  // The pull request, the description, and pages and pictures.
  served(OPEN_PULL_REQUEST_TOOL, (admitted, input) => runAgentOpenPullRequest(admitted, input), {
    gate: TOOL_GATE.REPOSITORY,
    alwaysLoad: true,
  }),
  served(
    EDIT_DESCRIPTION_TOOL,
    (admitted, input, { sandbox }) => runTurnCappedEditDescription(admitted, input, sandbox),
    { gate: TOOL_GATE.DESCRIPTIONS, alwaysLoad: true },
  ),
  served(LOOK_AT_PICTURE_TOOL, (admitted, input) => runAgentLookAtPicture(admitted, input), {
    gate: TOOL_GATE.DESCRIPTIONS,
    content: lookedPictureContent,
  }),
  served(
    SHOW_IMAGE_TOOL,
    (admitted, input, { sandbox }) => runAgentShowImage(admitted, input, sandbox),
    LOADED,
  ),
  served(
    CODER_SHOW_PAGE_TOOL,
    (admitted, input, { sandbox }) => runAgentShowPage(admitted, input, sandbox),
    LOADED,
  ),
  agentTool(READ_PAGE_TOOL),
  // The workspace's agents.
  agentTool(START_AGENT_TOOL, LOADED),
  agentTool(STOP_AGENT_TOOL),
  agentTool(LIST_AGENTS_TOOL, LOADED),
  agentTool(CODER_READ_AGENT_TOOL),
  agentTool(MESSAGE_AGENT_TOOL, LOADED),
  agentTool(UPDATE_AGENT_TOOL),
  agentTool(LIST_MODELS_TOOL),
  // Tasks and sections.
  agentTool(LIST_TASKS_TOOL),
  agentTool(READ_TASK_TOOL, LOADED),
  agentTool(CREATE_TASK_TOOL),
  agentTool(UPDATE_TASK_TOOL, LOADED),
  agentTool(CREATE_SECTION_TOOL),
  agentTool(DELETE_SECTION_TOOL),
  // Automations.
  agentTool(LIST_AUTOMATIONS_TOOL),
  agentTool(CREATE_AUTOMATION_TOOL),
  agentTool(UPDATE_AUTOMATION_TOOL),
  agentTool(DELETE_AUTOMATION_TOOL),
  agentTool(RUN_AUTOMATION_TOOL),
  // The workspace's shared memory.
  agentTool(SAVE_MEMORY_TOOL, { gate: TOOL_GATE.MEMORY }),
  agentTool(SEARCH_MEMORY_TOOL, { gate: TOOL_GATE.MEMORY }),
  // The description's comments.
  commentTool(READ_COMMENTS_TOOL),
  commentTool(REPLY_TO_COMMENT_TOOL),
  commentTool(UPDATE_COMMENT_TOOL),
  // The developer's Mac.
  served(RUN_ON_MAC_TOOL, (admitted, input) => runOnMacTool(admitted.target, input), {
    gate: TOOL_GATE.SANDBOX,
  }),
  // The agent's browser.
  served(BROWSER_TOOL, runAgentBrowser, { gate: TOOL_GATE.SANDBOX, content: browserContent }),
] as const;

/** The name of a tool the catalog serves. */
export type ServedTool = (typeof CATALOG)[number]["name"];

/** The tools served, by name, in the order `tools/list` names them. */
export const TOOL_CATALOG: ReadonlyMap<ServedTool, CatalogTool<ServedTool>> = new Map(
  CATALOG.map((tool) => [tool.name, tool]),
);

const SERVED_NAMES: ReadonlySet<string> = new Set(TOOL_CATALOG.keys());

/** Whether a name a harness called is one of the catalog's tools. */
export function isServedTool(name: string): name is ServedTool {
  return SERVED_NAMES.has(name);
}

/** Whether the agent is offered the tool: one behind no gate always, and a gated one where its gate is open to the agent. */
export function offers(standing: AgentStanding, tool: ServedTool): boolean {
  const gate = TOOL_CATALOG.get(tool)?.gate;
  return gate === undefined || standing.open.has(gate);
}

/**
 * The tools an agent is offered, in the catalog's order. Note that a
 * harness reads the list as its launch begins, so an agent is narrowed
 * launch by launch, and that a tool left off the list still runs when
 * called, so each gated tool's door refuses on its own.
 */
export function offeredTools(standing: AgentStanding): readonly CatalogTool<ServedTool>[] {
  return [...TOOL_CATALOG.values()].filter((tool) => offers(standing, tool.name));
}

/** The prefix of every status a door answers for a call it did not carry out (`not-run`, `not-looked`, `not-saved`, …). */
const NOT_DONE_PREFIX = "not-";

/** The statuses a door answers for a call it refused outright. */
const REFUSED_STATUSES: ReadonlySet<string> = new Set([
  ACTION_RESULT_STATUS.REJECTED,
  ACTION_RESULT_STATUS.UNSUPPORTED,
]);

/** Whether a door's answer is its refusal, which the server answers as a tool error the agent reads. */
export function refusedByDoor(result: WorkspaceMcpToolResult): boolean {
  const { status } = result;
  return (
    status !== undefined && (REFUSED_STATUSES.has(status) || status.startsWith(NOT_DONE_PREFIX))
  );
}
