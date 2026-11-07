import {
  AGENT_TOOL,
  CLAUDE_CODE_TOOL,
  CODEX_TOOL,
  EVE_TOOL,
  RETIRED_TOOL,
} from "@repo/features/agent-tools";
import { WireValueSchema } from "@repo/wire";
import { verbatimJsonSchema } from "@repo/wire/effect";
import type { ToolSet } from "ai";
import { wireValidatedTool } from "../../core.js";
import { connectionToolEntries } from "../../integrations/connection-tools.js";

/**
 * tool-set.ts -- every tool a coding agent's rows may name, as the store writer holds them.
 *
 * A row names our own tools (`AGENT_TOOL`, `@repo/features/agent-tools`), those the
 * native harnesses run themselves (Claude Code's and Codex's), the tools
 * an agent ran before the native harnesses, which old transcripts still
 * name, and the calls over each connection it was handed
 * (`../../integrations/connection-tools.ts`). The worker's own rows name
 * a few of the same tools, so one writer over this set holds both
 * transcripts. The writer holds every tool part of a row to a registered
 * tool, so each is registered here under the name its part spells; the
 * tool that ran declared its input itself, so what is held is that the
 * input is an object and not its fields, which that tool's own schema
 * already read before the call ran.
 */

/**
 * The tools a coding agent's transcript may name that no agent is offered
 * now: the retired runtime's provider-run page fetch, which coding agents ran before they had
 * the hosted page read, our own hosted search on our key, since
 * replaced by the retired runtime's provider-run `web_search` on the agent's own key, the archive, unarchive, and move of a task into a
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
 * The coding agent's tools as stored rows are held to them, built once for
 * the deployment, with the retired tools a transcript written before still
 * names, the two task controls (`EVE_TOOL`) a turn of the retired
 * runtime named where it waited on its worker or stopped one, Claude Code's own tools, which an agent running on Claude Code
 * calls under their CLI names, Codex's own work, which an agent running on
 * Codex does under its items' names (`../native-events/`), and each
 * connection's calls beside them (`../../integrations/connection-tools.ts`),
 * which the agent and its workers alike make.
 */
export const CODER_TOOL_SET: ToolSet = Object.fromEntries([
  ...[
    ...new Set([
      ...Object.values(AGENT_TOOL),
      EVE_TOOL.TASK_WAIT,
      EVE_TOOL.TASK_CANCEL,
      ...Object.values(RETIRED_CODER_TOOL),
      ...Object.values(CLAUDE_CODE_TOOL),
      ...Object.values(CODEX_TOOL),
    ]),
  ].map((name) => [name, wireValidatedTool(`the stored ${name} tool`, TOOL_INPUT)]),
  ...connectionToolEntries(),
]);
