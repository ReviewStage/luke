import { CLAUDE_CODE_TOOL, CODEX_TOOL, RETIRED_TOOL } from "@repo/features/agent-tools";
import { WireValueSchema } from "@repo/wire";
import { verbatimJsonSchema } from "@repo/wire/effect";
import type { ToolSet } from "ai";
import { wireValidatedTool } from "../../core.js";
import { connectionToolEntries } from "../../integrations/connection-tools.js";
import { AGENT_TOOL } from "../agent-runtime/tools.js";

/**
 * tool-set.ts -- every tool a coding agent's rows may name, as the store writer holds them.
 *
 * An eve agent ran eve's own tools, authored one file each in the eve app,
 * so the set is exactly this list and eve added nothing
 * beside it but its tools over each connection it was handed (`../../integrations/connection-tools.ts`): its shell and its file tools, the code extension's patch and
 * search, eve's provider-run web search on the agent's own model call and
 * key, the hosted page read, the delegation of a slice of its
 * work to a worker, the notes it takes on
 * its description (`description-edit.ts`), its to-do list, and the
 * threads it posts to the inbox (`inbox.ts`), the pull
 * request the service opens for it (`pull-request.ts`), its reach to the
 * other coding agents of its workspace, a message to one among it
 * (`../agent-tools.ts`, `agent-message.ts`), the load of one of its
 * repository's skills (`skills.ts`), the pages it shows the developer
 * (`../../tasks/page-tool.ts`), and eve's own durable `sleep`, which it waits on its
 * checks or a deploy with. The worker's own rows name
 * a few of the same tools (`../agent-runtime/tools.ts`), so one writer
 * over this set holds both transcripts. The writer holds every tool part
 * of a row to a registered tool, so each is registered here under the name
 * its part spells; eve declares each tool's input itself, so what is held
 * is that the input is an object and not its fields, which eve's own
 * schema already read before the call ran.
 */

/**
 * The tools the coding agent is offered, by the name eve mounts each under,
 * as the registry names them (`../agent-runtime/tools.ts`), named here for
 * the callers that pick one out.
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
  EDIT_DESCRIPTION: AGENT_TOOL.EDIT_DESCRIPTION,
  LOOK_AT_PICTURE: AGENT_TOOL.LOOK_AT_PICTURE,
  WRITE_TODOS: AGENT_TOOL.WRITE_TODOS,
  POST_THREAD: AGENT_TOOL.POST_THREAD,
  WITHDRAW_ASK: AGENT_TOOL.WITHDRAW_ASK,
  READ_THREADS: AGENT_TOOL.READ_THREADS,
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
  SAVE_MEMORY: AGENT_TOOL.SAVE_MEMORY,
  SEARCH_MEMORY: AGENT_TOOL.SEARCH_MEMORY,
  LOAD_SKILL: AGENT_TOOL.LOAD_SKILL,
  SHOW_PAGE: AGENT_TOOL.SHOW_PAGE,
  READ_COMMENTS: AGENT_TOOL.READ_COMMENTS,
  REPLY_TO_COMMENT: AGENT_TOOL.REPLY_TO_COMMENT,
  UPDATE_COMMENT: AGENT_TOOL.UPDATE_COMMENT,
  READ_PAGE: AGENT_TOOL.READ_PAGE,
  RUN_ON_MAC: AGENT_TOOL.RUN_ON_MAC,
  BROWSER: AGENT_TOOL.BROWSER,
  SHOW_IMAGE: AGENT_TOOL.SHOW_IMAGE,
  SLEEP: AGENT_TOOL.SLEEP,
} as const;

/**
 * The tools a coding agent's transcript may name that no agent is offered
 * now: eve's provider-run page fetch, which coding agents ran before they had
 * the hosted page read, our own hosted search on our key, since
 * replaced by eve's provider-run `web_search` on the agent's own key, the archive, unarchive, and move of a task into a
 * section since folded into `update_agent` and `update_task`, and the close
 * of and reply on an inbox item since folded into `withdraw_ask` and
 * `post_to_inbox`, that post and its read, since named `post_thread` and
 * `read_threads`, the four of the workspace's Chat, removed with it,
 * `create_channel`, `update_channel`, and `move_thread`, removed with the
 * channels they kept,
 * `show_code`, `draw_on_board`, and `look_at_board`, removed with the Code
 * and Board tabs, and a voice call's `queue_question`, `withdraw_question`,
 * and `end_call`, removed with GPT Live, `remember` and `recall`, since
 * named `save_memory` and `search_memory`, and `resolve_thread` and
 * `reopen_thread`, since folded into `update_comment`. A transcript written
 * then names them, and reads back under the same set.
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
  CREATE_CHANNEL: RETIRED_TOOL.CREATE_CHANNEL,
  UPDATE_CHANNEL: RETIRED_TOOL.UPDATE_CHANNEL,
  MOVE_THREAD: RETIRED_TOOL.MOVE_THREAD,
  SHOW_CODE: RETIRED_TOOL.SHOW_CODE,
  DRAW_ON_BOARD: RETIRED_TOOL.DRAW_ON_BOARD,
  LOOK_AT_BOARD: RETIRED_TOOL.LOOK_AT_BOARD,
  QUEUE_QUESTION: RETIRED_TOOL.QUEUE_QUESTION,
  WITHDRAW_QUESTION: RETIRED_TOOL.WITHDRAW_QUESTION,
  END_CALL: RETIRED_TOOL.END_CALL,
  REMEMBER: RETIRED_TOOL.REMEMBER,
  RECALL: RETIRED_TOOL.RECALL,
  RESOLVE_THREAD: RETIRED_TOOL.RESOLVE_THREAD,
  REOPEN_THREAD: RETIRED_TOOL.REOPEN_THREAD,
} as const;

const TOOL_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/**
 * The two task controls eve added beside any task, which a coding agent's
 * `delegate` was: eve ran them, so they are no
 * tool of ours, but a turn that waits on its worker or stops one names them.
 * Their tasks are eve's subagent tasks, not a task of ours.
 */
const CODER_TASK_TOOL = {
  TASK_WAIT: "task_wait",
  TASK_CANCEL: "task_cancel",
} as const;

/**
 * The coding agent's tools as stored rows are held to them, built once for
 * the deployment, with the retired tools a transcript written before still
 * names, Claude Code's own tools, which an agent running on Claude Code
 * calls under their CLI names, Codex's own work, which an agent running on
 * Codex does under its items' names (`../native-events/`), and each
 * connection's calls beside them (`../../integrations/connection-tools.ts`),
 * which the agent and its workers alike make.
 */
export const CODER_TOOL_SET: ToolSet = Object.fromEntries([
  ...[
    ...new Set([
      ...Object.values(AGENT_TOOL),
      ...Object.values(CODER_TASK_TOOL),
      ...Object.values(RETIRED_CODER_TOOL),
      ...Object.values(CLAUDE_CODE_TOOL),
      ...Object.values(CODEX_TOOL),
    ]),
  ].map((name) => [name, wireValidatedTool(`eve's ${name} tool`, TOOL_INPUT)]),
  ...connectionToolEntries(),
]);
