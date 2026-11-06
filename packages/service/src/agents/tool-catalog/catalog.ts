/**
 * catalog.ts -- every tool of ours an agent is served, declared once: its words, its schema, its gate, and its door.
 *
 * Claude Code and Codex keep their harness's own shell, files, todos, and
 * subagents; what touches the app reaches the agent as a tool of our MCP
 * server (`../workspace-mcp/app.ts`), and this catalog is that server's
 * every tool. Each is declared once here: the name, the description, and
 * the input schema its tool file declares; the gate it stands behind, if
 * any (`gates.ts`); whether Claude Code loads it from the first turn; the
 * door it runs through (`../coder-host/inbox-door.ts` for the inbox, the
 * agent tools' own runs for the workspace's agents, tasks, automations, and
 * memory, `../coder-host/agent-doors.ts` for the rest); and, for the tools whose
 * answer is a picture, how it is shown. A door is reached directly rather
 * than through the coder host, because the host composes eve's sandbox and
 * tools, which the web function serving the server does not bundle.
 *
 * What an agent is offered is read from here alone (`offeredTools`): the
 * server's `tools/list` and the agent's MCP popover both ask it, so neither
 * can name a tool the other does not. A call is answered through here as
 * well (`callTool`): one of a tool left off an agent's list, which a harness
 * may make anyway, is refused in its gate's words before its door is run.
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
  commentToolOf,
  READ_COMMENTS_TOOL,
  REPLY_TO_COMMENT_TOOL,
  UPDATE_COMMENT_TOOL,
} from "../../tasks/comment-tools.js";
import { CODER_SHOW_PAGE_TOOL } from "../../tasks/page-tool.js";
import {
  LOOK_AT_PICTURE_TOOL,
  lookNamedOnly,
  PICTURE_LOOK_STATUS,
  pictureNotLooked,
} from "../../tasks/picture-look.js";
import type { SentryApp } from "../../triggers/sentry/sentry-app-config.js";
import {
  AGENT_CALLER,
  type AgentCall,
  agentToolRejected,
  CODER_READ_AGENT_TOOL,
  LIST_AGENTS_TOOL,
  LIST_MODELS_TOOL,
  LIST_TASKS_TOOL,
  READ_PAGE_TOOL,
  runListAgents,
  runListModels,
  runListTasks,
  runReadAgent,
  runReadPage,
  runStartAgent,
  runStopAgent,
  runUpdateAgent,
  runUpdateTask,
  START_AGENT_TOOL,
  STOP_AGENT_TOOL,
  startAgentToolOf,
  UPDATE_AGENT_TOOL,
  UPDATE_TASK_TOOL,
  updateTaskToolOf,
} from "../agent-tools.js";
import {
  CREATE_AUTOMATION_TOOL,
  DELETE_AUTOMATION_TOOL,
  LIST_AUTOMATIONS_TOOL,
  RUN_AUTOMATION_TOOL,
  runCreateAutomation,
  runDeleteAutomation,
  runListAutomations,
  runRunAutomation,
  runUpdateAutomation,
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
  runAgentComment,
  runAgentEditDescription,
  runAgentLookAtPicture,
  runAgentOpenPullRequest,
  runAgentShowImage,
  runAgentShowPage,
} from "../coder-host/agent-doors.js";
import { MESSAGE_AGENT_TOOL, runMessageAgent } from "../coder-host/agent-message.js";
import { CODER_REFUSAL } from "../coder-host/bounds.js";
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
import { sessionsRouter } from "../coder-host/runtime-sessions.js";
import { SHOW_IMAGE_TOOL } from "../coder-host/show-image.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { macCommandNotRun, RUN_ON_MAC_TOOL, runOnMacTool } from "../mac-command.js";
import {
  runAgentRecall,
  runAgentRemember,
  SAVE_MEMORY_TOOL,
  SEARCH_MEMORY_TOOL,
} from "../memory-tools.js";
import {
  CREATE_SECTION_TOOL,
  DELETE_SECTION_TOOL,
  runCreateSection,
  runDeleteSection,
} from "../task-section-tools.js";
import {
  CREATE_TASK_TOOL,
  createTaskToolOf,
  READ_TASK_TOOL,
  readTaskToolOf,
  runCreateTask,
  runReadTask,
} from "../task-tools.js";
import type { ExperimentsOn } from "../workspace-experiment-on.js";
import { type AgentStanding, GATES, standingOf, TOOL_GATE, type ToolGate } from "./gates.js";

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
export interface WorkspaceMcpCallContext {
  readonly sandbox: InboxSandboxDoor;
  readonly callKey: Effect.Effect<string, StoreFailure, DatabaseServices>;
  readonly seams: AgentDoorSeams;
}

/** What a door runs with beside its input: the call's context, and where the agent stands against the gates, read once for the call (`callTool`). */
interface DoorContext extends WorkspaceMcpCallContext {
  readonly standing: AgentStanding;
}

/** One block of an MCP tool result: text, or an image or a sound as base64 with its type. */
export type McpContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image" | "audio"; readonly data: string; readonly mimeType: string };

/** Runs one call through a tool's door, as the agent's admitted conversation. */
type Door = (
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  context: DoorContext,
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
  /** How a call its gate shuts is answered, given the gate's words, where its door's refusal is no `rejected` with them (`gateRefusal`). */
  readonly refused?: (words: string) => WorkspaceMcpToolResult;
  /** The tool's words and input in the words of the agent's workspace's experiments, where they name one (`listedTool`); none for a tool whose words name none. */
  readonly variant?: (experiments: ExperimentsOn) => ToolSpec<string>;
}

/** A tool as its tool file declares it: its name, its words, and its input schema. */
interface ToolSpec<Name extends string> {
  readonly name: Name;
  readonly description: string;
  readonly inputSchema: Schema.Top;
}

/** What of a tool the catalog declares beside its spec and its door. */
type Served = Pick<CatalogTool, "gate" | "alwaysLoad" | "content" | "refused" | "variant">;

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

/** One of the agent tools about the workspace's agents and tasks (`../agent-tools.ts`), run under the call the agent makes. */
type AgentToolRun = (
  call: AgentCall,
  input: UnparsedWireValue,
) => Effect.Effect<WorkspaceMcpToolResult, never, WorkspaceMcpServices>;

/**
 * A tool about the workspace's agents and tasks, run as the agent the
 * conversation is, under the call's key: a message or a start keyed on it,
 * which reach the agents' sessions as the deployment acting for this agent's
 * starter. Note that the agent is the standing's own row, read once for the
 * call, and that an agent whose row is gone is refused before its key is read.
 */
function agentTool<const Name extends string>(
  spec: ToolSpec<Name>,
  run: AgentToolRun,
  options?: Served,
) {
  const door: Door = (admitted, input, { seams, callKey, standing }) => {
    if (Option.isNone(standing.agent)) {
      return Effect.succeed(agentToolRejected(CODER_REFUSAL.NO_AGENT));
    }
    const agent = standing.agent.value;
    const descriptionsOn = standing.open.has(TOOL_GATE.DESCRIPTIONS);
    return Effect.gen(function* () {
      const clientKey = yield* callKey;
      // Each agent the tools reach is answered by the runtime its conversation runs on (`../coder-host/runtime-sessions.ts`).
      const eveAs = yield* sessionsRouter;
      const call: AgentCall = {
        caller: { kind: AGENT_CALLER.AGENT, agent, descriptionsOn },
        eve: eveAs(agent.userId),
        eveAs,
        writer: seams.writer(),
        clientKey,
        summaryModel: seams.summaryModel,
      };
      return yield* run(call, input);
    });
  };
  return served(spec, door, options);
}

/** A tool of the comment threads, run through the comment door, its words the page threads' alone where the agent's workspace has Task descriptions off (`commentToolOf`). */
function commentTool<const Name extends CommentToolName>(spec: ToolSpec<Name>) {
  return served(
    spec,
    (admitted, input, { standing }) =>
      runAgentComment(admitted, spec.name, input, standing.open.has(TOOL_GATE.DESCRIPTIONS)),
    { variant: (experiments) => commentToolOf(spec.name, experiments) },
  );
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
    // Note that a look answers in its own shape, with the gate's words.
    refused: pictureNotLooked,
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
  agentTool(READ_PAGE_TOOL, runReadPage),
  // The workspace's agents.
  agentTool(START_AGENT_TOOL, runStartAgent, { ...LOADED, variant: startAgentToolOf }),
  agentTool(STOP_AGENT_TOOL, runStopAgent),
  agentTool(LIST_AGENTS_TOOL, runListAgents, LOADED),
  agentTool(CODER_READ_AGENT_TOOL, runReadAgent),
  agentTool(MESSAGE_AGENT_TOOL, runMessageAgent, LOADED),
  agentTool(UPDATE_AGENT_TOOL, runUpdateAgent),
  agentTool(LIST_MODELS_TOOL, runListModels),
  // Tasks and sections.
  agentTool(LIST_TASKS_TOOL, runListTasks),
  agentTool(READ_TASK_TOOL, runReadTask, { ...LOADED, variant: readTaskToolOf }),
  agentTool(CREATE_TASK_TOOL, runCreateTask, { variant: createTaskToolOf }),
  agentTool(UPDATE_TASK_TOOL, runUpdateTask, { ...LOADED, variant: updateTaskToolOf }),
  agentTool(CREATE_SECTION_TOOL, runCreateSection),
  agentTool(DELETE_SECTION_TOOL, runDeleteSection),
  // Automations.
  agentTool(LIST_AUTOMATIONS_TOOL, runListAutomations),
  agentTool(CREATE_AUTOMATION_TOOL, runCreateAutomation),
  agentTool(UPDATE_AUTOMATION_TOOL, runUpdateAutomation),
  agentTool(DELETE_AUTOMATION_TOOL, runDeleteAutomation),
  agentTool(RUN_AUTOMATION_TOOL, runRunAutomation),
  // The workspace's shared memory.
  agentTool(SAVE_MEMORY_TOOL, runAgentRemember, { gate: TOOL_GATE.MEMORY }),
  agentTool(SEARCH_MEMORY_TOOL, runAgentRecall, { gate: TOOL_GATE.MEMORY }),
  // The description's comments.
  commentTool(READ_COMMENTS_TOOL),
  commentTool(REPLY_TO_COMMENT_TOOL),
  commentTool(UPDATE_COMMENT_TOOL),
  // The developer's Mac.
  served(RUN_ON_MAC_TOOL, (admitted, input) => runOnMacTool(admitted.target, input), {
    gate: TOOL_GATE.SANDBOX,
    refused: macCommandNotRun,
  }),
  // The agent's browser.
  served(BROWSER_TOOL, runAgentBrowser, {
    gate: TOOL_GATE.SANDBOX,
    content: browserContent,
    refused: browserNotRun,
  }),
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
 * The words and input schema a tool is listed with to an agent: its
 * variant's, in the words of the agent's workspace's experiments, where it
 * has one, so an agent is told nothing of an experiment that is off; its
 * own otherwise.
 */
export function listedTool(
  tool: CatalogTool,
  standing: AgentStanding,
): Pick<CatalogTool, "description" | "inputSchema"> {
  if (tool.variant === undefined) return tool;
  const spec = tool.variant(standing.experiments);
  return { description: spec.description, inputSchema: emitJsonSchema(spec.inputSchema) };
}

/**
 * The tools an agent is offered, in the catalog's order. Note that a
 * harness reads the list as its launch begins, so an agent is narrowed
 * launch by launch, and that a tool left off the list may still be called,
 * which `callTool` refuses.
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

/** One call's answer: the tool's own result, and MCP's tool result of it, what the agent is shown and whether it is the tool's error. */
export interface ToolCallAnswer {
  readonly result: WorkspaceMcpToolResult;
  readonly content: readonly McpContent[];
  readonly isError: boolean;
}

/** A call refused at the tool's gate: in the tool's own refusal where it words one, else `rejected` with the gate's words. */
function gateRefusal(tool: CatalogTool, gate: ToolGate): WorkspaceMcpToolResult {
  const { refusal } = GATES[gate];
  const rejected = { status: ACTION_RESULT_STATUS.REJECTED, reason: refusal };
  return tool.refused?.(refusal) ?? rejected;
}

/** A result as the call answers it: as the tool shows it (a picture as an image), else its JSON as one text block, marked an error where it is a refusal. */
function answerOf(tool: CatalogTool, result: WorkspaceMcpToolResult): ToolCallAnswer {
  return {
    result,
    content: tool.content?.(result) ?? [{ type: "text", text: JSON.stringify(result) }],
    isError: refusedByDoor(result),
  };
}

/**
 * Runs one call of a served tool as the agent's admitted conversation: the
 * agent's standing read once (`standingOf`), the call refused in its gate's
 * words without its door run where the gate is shut to the agent, and run
 * through its door with the standing otherwise. Note that the gate is read
 * on every call, not only on the list, because a harness may call a tool
 * it was not listed, or a gate may shut mid-run.
 */
export function callTool(
  admitted: AdmittedConversation,
  name: ServedTool,
  input: UnparsedWireValue,
  context: WorkspaceMcpCallContext,
): Effect.Effect<ToolCallAnswer, unknown, WorkspaceMcpToolServices> {
  const tool = TOOL_CATALOG.get(name);
  if (tool === undefined) return Effect.die(new Error(`${name} has no catalog entry`));
  return Effect.flatMap(standingOf(admitted), (standing) => {
    const { gate } = tool;
    if (gate !== undefined && !standing.open.has(gate)) {
      return Effect.succeed(answerOf(tool, gateRefusal(tool, gate)));
    }
    return Effect.map(tool.run(admitted, input, { ...context, standing }), (result) =>
      answerOf(tool, result),
    );
  });
}
