import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { CLAUDE_CODE_TOOL, CODEX_TOOL, RETIRED_TOOL } from "@luke/features/agent-tools";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { inboxSandboxPicturePaths } from "@luke/features/inbox-attachment-link";
import { ACTION_RESULT_STATUS, type WireRecord, WireValueSchema } from "@luke/wire";
import { verbatimJsonSchema } from "@luke/wire/effect";
import type { ToolSet } from "ai";
import { Option, Schema } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { wireValidatedTool } from "../../core.js";
import { connectionToolEntries } from "../../integrations/connection-tools.js";
import { AGENT_ROLE } from "../agent-runtime/role.js";
import { AGENT_TOOL, toolsOf } from "../agent-runtime/tools.js";
import { BRAIN_HOST_TURN, type BrainHostTurn } from "../brain-host/bounds.js";

/**
 * tool-set.ts -- every tool a coding agent's rows may name, as the store writer holds them.
 *
 * The coding agent runs eve's own tools, authored one file each under
 * `apps/dev/tools/` so the set is exactly this list and eve adds nothing
 * beside it but its two over the Linear connection (`../connection-tools.ts`): its shell and its file tools, the code extension's patch and
 * search, eve's provider-run web search on the agent's own model call and
 * key, the hosted page read (`../public-research.ts`), the delegation of a slice of its
 * work to a worker (`apps/dev/tools/delegate.ts`), the notes it takes on
 * its plan (`plan-edit.ts`), its to-do list (`todos.ts`), and the
 * threads it posts to its workspace's channels (`inbox.ts`), the pull
 * request the service opens for it (`pull-request.ts`), its reach to the
 * other coding agents of its workspace, a message to one among it
 * (`../coding-agent-tools.ts`, `agent-message.ts`), the load of one of its
 * repository's skills (`skills.ts`), and the pages it shows the developer
 * (`../page-tool.ts`), eve's own durable `sleep`, which it waits on its
 * checks or a deploy with, and the call's own question queue and hang-up,
 * refused off a call (`runCallTool`). The worker's own rows name
 * the read-only few of the same tools (`WORKER_TOOL_NAMES`), so one writer
 * over this set holds both transcripts. The writer holds every tool part
 * of a row to a registered tool, so each is registered here under the name
 * its part spells; eve declares each tool's input itself, so what is held
 * is that the input is an object and not its fields, which eve's own
 * schema already read before the call ran.
 */

/**
 * The tools the coding agent is offered, by the name eve mounts each under:
 * the coder's in the registry (`../agent-runtime/tools.ts`), named here for
 * the callers that pick one out. Its test holds this to the registry's role.
 */
export const CODER_TOOL = {
  BASH: AGENT_TOOL.BASH,
  READ_FILE: AGENT_TOOL.READ_FILE,
  WRITE_FILE: AGENT_TOOL.WRITE_FILE,
  GLOB: AGENT_TOOL.GLOB,
  GREP: AGENT_TOOL.GREP,
  APPLY_PATCH: AGENT_TOOL.APPLY_PATCH,
  WEB_SEARCH: AGENT_TOOL.WEB_SEARCH,
  READ_WEB_PAGE: AGENT_TOOL.READ_WEB_PAGE,
  DELEGATE: AGENT_TOOL.DELEGATE,
  EDIT_PLAN: AGENT_TOOL.EDIT_PLAN,
  LOOK_AT_PICTURE: AGENT_TOOL.LOOK_AT_PICTURE,
  WRITE_TODOS: AGENT_TOOL.WRITE_TODOS,
  POST_THREAD: AGENT_TOOL.POST_THREAD,
  WITHDRAW_ASK: AGENT_TOOL.WITHDRAW_ASK,
  READ_THREADS: AGENT_TOOL.READ_THREADS,
  CREATE_CHANNEL: AGENT_TOOL.CREATE_CHANNEL,
  UPDATE_CHANNEL: AGENT_TOOL.UPDATE_CHANNEL,
  MOVE_THREAD: AGENT_TOOL.MOVE_THREAD,
  LIST_OPEN_ASKS: AGENT_TOOL.LIST_OPEN_ASKS,
  OPEN_PULL_REQUEST: AGENT_TOOL.OPEN_PULL_REQUEST,
  LIST_AGENTS: AGENT_TOOL.LIST_AGENTS,
  READ_AGENT: AGENT_TOOL.READ_AGENT,
  MESSAGE_AGENT: AGENT_TOOL.MESSAGE_AGENT,
  START_AGENT: AGENT_TOOL.START_AGENT,
  STOP_AGENT: AGENT_TOOL.STOP_AGENT,
  UPDATE_AGENT: AGENT_TOOL.UPDATE_AGENT,
  LIST_TASKS: AGENT_TOOL.LIST_TASKS,
  READ_TASK: AGENT_TOOL.READ_TASK,
  CREATE_TASK: AGENT_TOOL.CREATE_TASK,
  CREATE_SECTION: AGENT_TOOL.CREATE_SECTION,
  DELETE_SECTION: AGENT_TOOL.DELETE_SECTION,
  UPDATE_TASK: AGENT_TOOL.UPDATE_TASK,
  LIST_AUTOMATIONS: AGENT_TOOL.LIST_AUTOMATIONS,
  CREATE_AUTOMATION: AGENT_TOOL.CREATE_AUTOMATION,
  UPDATE_AUTOMATION: AGENT_TOOL.UPDATE_AUTOMATION,
  DELETE_AUTOMATION: AGENT_TOOL.DELETE_AUTOMATION,
  RUN_AUTOMATION: AGENT_TOOL.RUN_AUTOMATION,
  LIST_MODELS: AGENT_TOOL.LIST_MODELS,
  REMEMBER: AGENT_TOOL.REMEMBER,
  RECALL: AGENT_TOOL.RECALL,
  LOAD_SKILL: AGENT_TOOL.LOAD_SKILL,
  SHOW_PAGE: AGENT_TOOL.SHOW_PAGE,
  READ_COMMENTS: AGENT_TOOL.READ_COMMENTS,
  REPLY_TO_COMMENT: AGENT_TOOL.REPLY_TO_COMMENT,
  RESOLVE_THREAD: AGENT_TOOL.RESOLVE_THREAD,
  REOPEN_THREAD: AGENT_TOOL.REOPEN_THREAD,
  READ_PAGE: AGENT_TOOL.READ_PAGE,
  RUN_ON_MAC: AGENT_TOOL.RUN_ON_MAC,
  BROWSER: AGENT_TOOL.BROWSER,
  SHOW_IMAGE: AGENT_TOOL.SHOW_IMAGE,
  SLEEP: AGENT_TOOL.SLEEP,
  QUEUE_QUESTION: AGENT_TOOL.QUEUE_QUESTION,
  WITHDRAW_QUESTION: AGENT_TOOL.WITHDRAW_QUESTION,
  END_CALL: AGENT_TOOL.END_CALL,
  SHOW_CODE: AGENT_TOOL.SHOW_CODE,
  DRAW_ON_BOARD: AGENT_TOOL.DRAW_ON_BOARD,
  LOOK_AT_BOARD: AGENT_TOOL.LOOK_AT_BOARD,
} as const;

/** The tools that act on the agent's task: `edit_plan`, which takes notes in its plan, `show_page`, which shows a page on it (or on the agent itself where it works on none), `look_at_picture`, which looks at a picture in its plan, the four that read and answer its comments, and the two that draw on and look at its whiteboard. */
export type TaskTool =
  | typeof CODER_TOOL.EDIT_PLAN
  | typeof CODER_TOOL.SHOW_PAGE
  | typeof CODER_TOOL.LOOK_AT_PICTURE
  | (typeof COMMENT_TASK_TOOLS)[number]
  | (typeof BOARD_TASK_TOOLS)[number];

/** The comment tools every agent on a task is offered, since a member may send any of them a thread. */
const COMMENT_TASK_TOOLS = [
  CODER_TOOL.READ_COMMENTS,
  CODER_TOOL.REPLY_TO_COMMENT,
  CODER_TOOL.RESOLVE_THREAD,
  CODER_TOOL.REOPEN_THREAD,
] as const;

/** The whiteboard's tools, which draw on the task's board and look at it as the developer's Mac drew it (`../../tasks/board-tool.ts`, `../../tasks/board-look.ts`). */
const BOARD_TASK_TOOLS = [CODER_TOOL.DRAW_ON_BOARD, CODER_TOOL.LOOK_AT_BOARD] as const;

/**
 * The task's tools an agent is offered: `show_page` alone for one on no
 * task, as an automation's run starts one, whose pages stand on the agent
 * itself, and all of them for one on a task, whether
 * it was handed the plan or a prompt, since New task starts every agent on
 * the developer's own words while Luke writes the plan beside it. Note that
 * each tool withheld is one its call would only be refused by (`host.ts`'s
 * `editPlan`, `showPage`, and `board`), and that the instructions leave out
 * the same words (`instructions.ts`).
 */
export function taskToolsOf(agent: Pick<CodingAgent, "taskId">): ReadonlySet<TaskTool> {
  // A page stands on the agent itself where it works on no task, so every agent shows one.
  if (agent.taskId === null) return new Set([CODER_TOOL.SHOW_PAGE]);
  return new Set([
    CODER_TOOL.EDIT_PLAN,
    CODER_TOOL.SHOW_PAGE,
    CODER_TOOL.LOOK_AT_PICTURE,
    ...COMMENT_TASK_TOOLS,
    ...BOARD_TASK_TOOLS,
  ]);
}

/** The call's own tools, which mean something only while someone is listening (`../../tasks/queue-question.ts`, `../../tasks/end-call.ts`). */
export type CallTool =
  | typeof CODER_TOOL.QUEUE_QUESTION
  | typeof CODER_TOOL.WITHDRAW_QUESTION
  | typeof CODER_TOOL.END_CALL;

/**
 * Why each of the call's own tools is refused on a turn no call is live on.
 * Note that they are offered on every turn, spoken or typed, so the tools a
 * turn sends, which lead its prompt, are the same whichever kind it is, and
 * a call that starts mid-PR reads the agent's history from the provider's
 * cache; off a call each refuses as other tools refuse.
 */
const OFF_CALL_REASON = {
  [CODER_TOOL.QUEUE_QUESTION]:
    "No call is live, so no one hears a queued question: post it to the developer in a thread instead.",
  [CODER_TOOL.WITHDRAW_QUESTION]: "No call is live, so no question waits on one.",
  [CODER_TOOL.END_CALL]: "No call is live to end.",
} as const satisfies Record<CallTool, string>;

/** One call of the call's own tools as the turn's kind answers it: its run on a spoken turn, refused on any other. */
export function runCallTool(
  turn: BrainHostTurn | undefined,
  tool: CallTool,
  run: () => WireRecord,
): WireRecord {
  return turn === BRAIN_HOST_TURN.SPOKEN
    ? run()
    : { status: ACTION_RESULT_STATUS.REJECTED, reason: OFF_CALL_REASON[tool] };
}

/** The tools only an agent working in a repository is offered: the pull request the service opens for it, the two that write into its checkout, and `show_code`, which puts lines of it on the developer's screen. */
export type RepositoryTool =
  | typeof CODER_TOOL.OPEN_PULL_REQUEST
  | typeof CODER_TOOL.WRITE_FILE
  | typeof CODER_TOOL.APPLY_PATCH
  | typeof CODER_TOOL.SHOW_CODE;

/**
 * The repository's tools an agent is offered, on every turn, typed or
 * spoken: all of them for one working in a repository, and none for one
 * with no repository, whose sandbox holds no checkout to write into or
 * show lines of and which has no branch to open a pull request from. Note that its shell and its reads stay, in the empty working folder
 * its sandbox opens with (`checkout.ts`'s `openWorkingFolder`), and that the
 * instructions leave out the same words (`instructions.ts`).
 */
export function repositoryToolsOf(
  agent: Pick<CodingAgent, "repository">,
): ReadonlySet<RepositoryTool> {
  if (agent.repository === null) return new Set();
  return new Set([
    CODER_TOOL.OPEN_PULL_REQUEST,
    CODER_TOOL.WRITE_FILE,
    CODER_TOOL.APPLY_PATCH,
    CODER_TOOL.SHOW_CODE,
  ]);
}

/** The tools offered by what kind of agent it is: `list_open_asks` to an operator alone, and `delete_section` and `delete_automation` to every agent but an operator. */
export type KindTool =
  | typeof CODER_TOOL.LIST_OPEN_ASKS
  | typeof CODER_TOOL.DELETE_SECTION
  | typeof CODER_TOOL.DELETE_AUTOMATION;

/**
 * The tools an agent is offered by its kind, on every turn: an operator
 * reads every open ask to its member across their agents, and deletes
 * nothing, under Dean's Steward policy (`../steward.ts`), so it is offered
 * `list_open_asks` and never `delete_section` or `delete_automation`; every
 * other agent the reverse.
 * Note that each tool withheld is one its call would only be refused by,
 * since a native harness is offered every tool: an operator's delete by its
 * door (`agent-doors.ts`'s `runAgentTools`), and another agent's read of the
 * member's asks by the tool itself (`../operator-desk.ts`); and that the
 * instructions leave out the same words (`instructions.ts`).
 */
export function kindToolsOf(agent: Pick<CodingAgent, "kind">): ReadonlySet<KindTool> {
  return agent.kind === CODING_AGENT_KIND.OPERATOR
    ? new Set([CODER_TOOL.LIST_OPEN_ASKS])
    : new Set([CODER_TOOL.DELETE_SECTION, CODER_TOOL.DELETE_AUTOMATION]);
}

/**
 * The tools a coding agent's transcript may name that no agent is offered
 * now: eve's provider-run page fetch, which coding agents ran before they had
 * the hosted page read, Luke's own hosted search on Luke's key, since
 * replaced by eve's provider-run `web_search` on the agent's own key, the archive, unarchive, and move of a task into a
 * section since folded into `update_agent` and `update_task`, and the close
 * of and reply on an inbox item since folded into `withdraw_ask` and
 * `post_to_inbox`, that post and its read, since named `post_thread` and
 * `read_threads`, and the four of the workspace's Chat, removed with it. A
 * transcript written then names them, and reads back under the same set.
 */
export const RETIRED_CODER_TOOL = {
  WEB_FETCH: "web_fetch",
  SEARCH_WEB: RETIRED_TOOL.SEARCH_WEB,
  ARCHIVE_AGENT: RETIRED_TOOL.ARCHIVE_AGENT,
  UNARCHIVE_AGENT: RETIRED_TOOL.UNARCHIVE_AGENT,
  MOVE_TASK: RETIRED_TOOL.MOVE_TASK,
  CLOSE_INBOX_ITEM: RETIRED_TOOL.CLOSE_INBOX_ITEM,
  REPLY_INBOX: RETIRED_TOOL.REPLY_INBOX,
  POST_TO_INBOX: RETIRED_TOOL.POST_TO_INBOX,
  READ_INBOX: RETIRED_TOOL.READ_INBOX,
  POST_CHAT: RETIRED_TOOL.POST_CHAT,
  READ_CHAT: RETIRED_TOOL.READ_CHAT,
  RESOLVE_ASK: RETIRED_TOOL.RESOLVE_ASK,
  EDIT_CHANNEL: RETIRED_TOOL.EDIT_CHANNEL,
} as const;

/**
 * The tools whose every call runs in the agent's sandbox, which is what
 * tells the host a sandbox was opened. A delegation is not among them: a
 * worker opens the agent's sandbox only when it reads the checkout, and a
 * refused or web-only delegation opens none, so counting it would have the
 * turn's end open a sandbox, checkout and all, only to stop it. A sandbox a
 * worker opened is stopped at the end of the first turn in which the agent
 * runs a sandbox tool of its own, which a turn that edits always does.
 */
const SANDBOX_TOOLS: ReadonlySet<string> = new Set([
  CODER_TOOL.BASH,
  CODER_TOOL.READ_FILE,
  CODER_TOOL.WRITE_FILE,
  CODER_TOOL.GLOB,
  CODER_TOOL.GREP,
  CODER_TOOL.APPLY_PATCH,
  CODER_TOOL.SHOW_IMAGE,
  CODER_TOOL.SHOW_CODE,
  // The browser runs in the sandbox, which its call opens first.
  CODER_TOOL.BROWSER,
]);

/** What a thread post's input is read for here: its body, whose pictures name files in the sandbox. */
const readPostedBody = Schema.decodeUnknownOption(Schema.Struct({ body: Schema.String }));

/**
 * Whether an event of the agent's session opened its sandbox: a request for
 * a sandbox tool, for a page read from a file in the sandbox, for an
 * edit of the plan adding a picture read from one, or for a thread post
 * whose body draws one by a path naming no
 * scheme, each read from a file in the sandbox, or a message
 * received with files, which eve stages in the sandbox before the
 * turn opens, opening it to do so.
 */
export function opensSandbox(event: MessageStreamEvent): boolean {
  switch (event.type) {
    case "actions.requested":
      return event.data.actions.some(
        (action) =>
          action.kind === "tool-call" &&
          (SANDBOX_TOOLS.has(action.toolName) ||
            (action.toolName === CODER_TOOL.SHOW_PAGE && "path" in action.input) ||
            (action.toolName === CODER_TOOL.EDIT_PLAN &&
              Array.isArray(action.input.pictures) &&
              action.input.pictures.length > 0) ||
            (action.toolName === CODER_TOOL.POST_THREAD &&
              Option.exists(
                readPostedBody(action.input),
                ({ body }) => inboxSandboxPicturePaths(body).length > 0,
              ))),
      );
    case "message.received":
      return event.data.parts?.some((part) => part.type === "file") ?? false;
    default:
      return false;
  }
}

/** A call's input as the row keeps it: one JSON object, whose fields are eve's own tool's to read. */
const TOOL_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/**
 * The two task controls eve adds beside any task, which a coding agent's
 * \`delegate\` is (\`apps/dev/tools/delegate.ts\`): eve runs them, so they are no
 * tool of Luke's, but a turn that waits on its worker or stops one names them.
 * Their tasks are eve's subagent tasks, not a Luke task.
 */
const CODER_TASK_TOOL = {
  TASK_WAIT: "task_wait",
  TASK_CANCEL: "task_cancel",
} as const;

/**
 * The coding agent's tools as stored rows are held to them, built once for
 * the deployment, with the retired web reads a transcript written before
 * still names, Claude Code's own tools, which an agent running on Claude Code
 * calls under their CLI names, Codex's own work, which an agent running on
 * Codex does under its items' names (`../native-events/`), and the Linear
 * connection's calls beside them (`../connection-tools.ts`), which the agent
 * and its workers alike make.
 */
export const CODER_TOOL_SET: ToolSet = Object.fromEntries([
  ...[
    ...new Set([
      ...toolsOf(AGENT_ROLE.CODER),
      ...toolsOf(AGENT_ROLE.CODER_WORKER),
      ...Object.values(CODER_TASK_TOOL),
      ...Object.values(RETIRED_CODER_TOOL),
      ...Object.values(CLAUDE_CODE_TOOL),
      ...Object.values(CODEX_TOOL),
    ]),
  ].map((name) => [name, wireValidatedTool(`eve's ${name} tool`, TOOL_INPUT)]),
  ...connectionToolEntries(),
]);
