/**
 * agent-tools.ts -- every tool name a Luke agent's transcript may carry, which the service offers and the desktop draws.
 *
 * The service's tool registry (`packages/service/src/agents/agent-runtime/tools.ts`)
 * says which roles each of Luke's tools serves; the names themselves are
 * declared here, once, so the desktop reads a call in a transcript by the
 * same name the service offered it under, the planning model's as a coding
 * agent's. Beside them stand the names eve gives tools of its own that a
 * planning transcript carries, and the coding agents' web reads that earlier
 * transcripts still name.
 */

import { DRAW_ON_BOARD_TOOL_NAME, LOOK_AT_BOARD_TOOL_NAME } from "./board-vocabulary.js";
import { CHAT_TOOL } from "./chat-wire.js";
import { CODING_AGENT_DELEGATE_TOOL, CODING_AGENT_TODOS_TOOL } from "./coding-agent-wire.js";
import { INBOX_TOOL } from "./inbox-wire.js";
import { SHOW_PAGE_TOOL_NAME } from "./page-wire.js";

/** Every tool Luke authors or declares for a model, by the name the model calls it by. */
export const AGENT_TOOL = {
  // The planning model's own, which its hosted resolver declares.
  QUEUE_QUESTION: "queue_question",
  WITHDRAW_QUESTION: "withdraw_question",
  SHOW_CODE: "show_code",
  RUN_IN_REPOSITORY: "run_in_repository",
  DRAW_ON_BOARD: DRAW_ON_BOARD_TOOL_NAME,
  LOOK_AT_BOARD: LOOK_AT_BOARD_TOOL_NAME,
  // A look at one of the plan's pictures, the planning model's and a coding agent's.
  LOOK_AT_PICTURE: "look_at_picture",
  END_CALL: "end_call",
  // The tools about the workspace's coding agents, named for any agent offered them.
  LIST_AGENTS: "list_agents",
  READ_AGENT: "read_agent",
  MESSAGE_AGENT: "message_agent",
  START_AGENT: "start_agent",
  ARCHIVE_AGENT: "archive_agent",
  UNARCHIVE_AGENT: "unarchive_agent",
  LIST_TASKS: "list_tasks",
  // The public reads, every role's.
  SEARCH_WEB: "search_web",
  READ_WEB_PAGE: "read_web_page",
  // A command on the developer's own Mac, every role's.
  RUN_ON_MAC: "run_on_mac",
  // eve's shell and file tools and the code extension's, started in a coding agent's checkout.
  BASH: "bash",
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  GLOB: "glob",
  GREP: "grep",
  APPLY_PATCH: "apply_patch",
  // A coding agent's own, and the delegation every agent makes.
  DELEGATE: CODING_AGENT_DELEGATE_TOOL,
  EDIT_PLAN: "edit_plan",
  WRITE_TODOS: CODING_AGENT_TODOS_TOOL,
  POST_TO_INBOX: INBOX_TOOL.POST,
  CLOSE_INBOX_ITEM: INBOX_TOOL.CLOSE,
  READ_INBOX: INBOX_TOOL.READ,
  OPEN_PULL_REQUEST: "open_pull_request",
  // The workspace's chat, the planner's and every coding agent's.
  POST_CHAT: CHAT_TOOL.POST,
  READ_CHAT: CHAT_TOOL.READ,
  RESOLVE_ASK: CHAT_TOOL.RESOLVE,
  // eve's own, which loads one of the skills a session is offered.
  LOAD_SKILL: "load_skill",
  // An interactive page shown in the plan's side panel.
  SHOW_PAGE: SHOW_PAGE_TOOL_NAME,
  // Pictures from a coding agent's sandbox, shown in its transcript.
  SHOW_IMAGE: "show_image",
  // eve's own durable pause, which a coding agent takes before it checks on its checks or a deploy again.
  SLEEP: "sleep",
} as const;

export type AgentTool = (typeof AGENT_TOOL)[keyof typeof AGENT_TOOL];

/**
 * The tools eve gives a planning session of its own, which its transcript
 * carries: its subagent tool for the worker, which earlier transcripts name
 * where the planning model now calls its own `delegate`, and the two task
 * controls it adds beside any task. Note that their names are eve's own and
 * the tasks they name are eve's subagent tasks, not a Luke task.
 */
export const EVE_TOOL = {
  WORKER: "worker",
  TASK_WAIT: "task_wait",
  TASK_CANCEL: "task_cancel",
} as const;

/**
 * eve's own two tools for a connection, which any agent's transcript may
 * carry: one lists a connection's tools and one runs one. The call it ran
 * is stored beside the run, under its integration's remote name
 * (`integration-wire.ts`'s `INTEGRATION_REMOTE_TOOL`).
 */
export const CONNECTION_TOOL = {
  SEARCH: "connection_search",
  EXECUTE: "connection_execute",
} as const;

/**
 * Tools no agent is offered now whose calls a transcript written then still
 * names: eve's provider-run web reads, which coding agents ran before they
 * had the public reads, and the planning model's four tools about the
 * task's coding agents, since named as `AGENT_TOOL`'s agent tools.
 */
export const RETIRED_TOOL = {
  WEB_FETCH: "web_fetch",
  WEB_SEARCH: "web_search",
  LIST_CODING_AGENTS: "list_coding_agents",
  READ_CODING_AGENT: "read_coding_agent",
  MESSAGE_CODING_AGENT: "message_coding_agent",
  START_CODING_AGENT: "start_coding_agent",
} as const;
