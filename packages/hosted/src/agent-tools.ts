/**
 * agent-tools.ts -- every tool name a Luke agent's transcript may carry, which the service offers and the desktop draws.
 *
 * The service's tool registry (`apps/web/server/hosted/agent-runtime/tools.ts`)
 * says which roles each of Luke's tools serves; the names themselves are
 * declared here, once, so the desktop reads a call in a transcript by the
 * same name the service offered it under, the planning model's as a coding
 * agent's. Beside them stand the names eve gives tools of its own that a
 * planning transcript carries, and the coding agents' web reads that earlier
 * transcripts still name.
 */

import { DRAW_ON_BOARD_TOOL_NAME, LOOK_AT_BOARD_TOOL_NAME } from "./board-vocabulary.js";
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
  LIST_CODING_AGENTS: "list_coding_agents",
  READ_CODING_AGENT: "read_coding_agent",
  MESSAGE_CODING_AGENT: "message_coding_agent",
  START_CODING_AGENT: "start_coding_agent",
  END_CALL: "end_call",
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
  READ_PLAN: "read_plan",
  WRITE_TODOS: CODING_AGENT_TODOS_TOOL,
  POST_TO_INBOX: INBOX_TOOL.POST,
  CLOSE_INBOX_ITEM: INBOX_TOOL.CLOSE,
  READ_INBOX: INBOX_TOOL.READ,
  // eve's own, which loads one of the skills a session is offered.
  LOAD_SKILL: "load_skill",
  // An interactive page shown in the plan's side panel.
  SHOW_PAGE: SHOW_PAGE_TOOL_NAME,
} as const;

export type AgentTool = (typeof AGENT_TOOL)[keyof typeof AGENT_TOOL];

/**
 * The tools eve gives a planning session of its own, which its transcript
 * carries: its subagent tool for the worker, which earlier transcripts name
 * where the planning model now calls its own `delegate`, and the two task
 * controls it adds beside any task.
 */
export const EVE_TOOL = {
  WORKER: "worker",
  TASK_WAIT: "task_wait",
  TASK_CANCEL: "task_cancel",
} as const;

/**
 * eve's provider-run web reads, which coding agents ran before they had the
 * public reads: no agent is offered them now, but a transcript written then
 * names them.
 */
export const RETIRED_TOOL = {
  WEB_FETCH: "web_fetch",
  WEB_SEARCH: "web_search",
} as const;
