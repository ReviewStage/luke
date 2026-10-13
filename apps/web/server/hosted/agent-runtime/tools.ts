/**
 * tools.ts -- every tool Luke offers any of its agents, and the roles each one serves.
 *
 * The one registry of the agent runtime's tools (`docs/proposals/one-agent-runtime.md`):
 * each tool is named once here, by the name a model calls it by, with the
 * roles it serves (`role.ts`), and everything that would otherwise be kept
 * twice is derived from it: what each planning agent is offered
 * (`../brain-host/planning.ts`), what each coding agent's authored tools are
 * (`../coder-host/tool-set.ts`, held to the files under `coder/tools/` by
 * its test), and every set the store writer holds a role's rows to. A tool
 * a role is not listed for is never offered to it, so adding a tool to a
 * role is one entry here and its implementation where the role's root
 * reaches it. The tools eve injects of its own beside a task or a connection
 * (`task_wait`, `task_cancel`, `connection_search`, `connection_execute`)
 * and a declared subagent's own tool are eve's, not Luke's, and are not
 * listed.
 *
 * This module is a leaf: a tool's module takes its name from here, so the
 * registry imports no tool and no host, and every module may import it.
 */

import { DRAW_ON_BOARD_TOOL_NAME, LOOK_AT_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import {
  CODING_AGENT_DELEGATE_TOOL,
  CODING_AGENT_TODOS_TOOL,
} from "@sidecar/hosted/coding-agent-wire";
import { INBOX_TOOL } from "@sidecar/hosted/inbox-wire";
import { SHOW_PAGE_TOOL_NAME } from "@sidecar/hosted/page-wire";
import { AGENT_ROLE, type AgentRole } from "./role.js";

/** Every tool Luke authors or declares for a model, by the name the model calls it by. */
export const AGENT_TOOL = {
  // The planning model's own, which the hosted resolver declares (`../brain-host/planning.ts`).
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
  // The public reads, every role's (`../public-research.ts`).
  SEARCH_WEB: "search_web",
  READ_WEB_PAGE: "read_web_page",
  // eve's shell and file tools and the code extension's, started in a coding agent's checkout (`../coder-host/files.ts`).
  BASH: "bash",
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  GLOB: "glob",
  GREP: "grep",
  APPLY_PATCH: "apply_patch",
  // A coding agent's own, authored one file each under `coder/tools/`.
  DELEGATE: CODING_AGENT_DELEGATE_TOOL,
  EDIT_PLAN: "edit_plan",
  WRITE_TODOS: CODING_AGENT_TODOS_TOOL,
  POST_TO_INBOX: INBOX_TOOL.POST,
  CLOSE_INBOX_ITEM: INBOX_TOOL.CLOSE,
  READ_INBOX: INBOX_TOOL.READ,
  // eve's own, which loads one of the skills a session is offered (`skills.ts`).
  LOAD_SKILL: "load_skill",
  // An interactive page shown in the plan's side panel, the planning model's and a coding agent's alike (`../page-tool.ts`).
  SHOW_PAGE: SHOW_PAGE_TOOL_NAME,
} as const;

export type AgentTool = (typeof AGENT_TOOL)[keyof typeof AGENT_TOOL];

const { PLANNER, PLANNER_WORKER, CODER, CODER_WORKER } = AGENT_ROLE;

/**
 * The roles each tool serves. Note that a planning worker is offered only the
 * reads, never a tool that speaks, shows, or draws, because what reaches the
 * developer reaches them through the planning turn the voice follows; and a
 * coding agent's worker only the reads of the checkout and the web, so
 * workers run in parallel without colliding and the agent alone edits.
 */
export const TOOL_ROLES = {
  [AGENT_TOOL.QUEUE_QUESTION]: [PLANNER],
  [AGENT_TOOL.WITHDRAW_QUESTION]: [PLANNER],
  [AGENT_TOOL.SHOW_CODE]: [PLANNER],
  [AGENT_TOOL.RUN_IN_REPOSITORY]: [PLANNER, PLANNER_WORKER],
  [AGENT_TOOL.DRAW_ON_BOARD]: [PLANNER],
  [AGENT_TOOL.LOOK_AT_BOARD]: [PLANNER],
  [AGENT_TOOL.LIST_CODING_AGENTS]: [PLANNER],
  [AGENT_TOOL.READ_CODING_AGENT]: [PLANNER],
  [AGENT_TOOL.MESSAGE_CODING_AGENT]: [PLANNER],
  [AGENT_TOOL.START_CODING_AGENT]: [PLANNER],
  [AGENT_TOOL.END_CALL]: [PLANNER],
  [AGENT_TOOL.SEARCH_WEB]: [PLANNER, PLANNER_WORKER, CODER, CODER_WORKER],
  [AGENT_TOOL.READ_WEB_PAGE]: [PLANNER, PLANNER_WORKER, CODER, CODER_WORKER],
  [AGENT_TOOL.BASH]: [CODER, CODER_WORKER],
  [AGENT_TOOL.READ_FILE]: [CODER, CODER_WORKER],
  [AGENT_TOOL.WRITE_FILE]: [CODER],
  [AGENT_TOOL.GLOB]: [CODER, CODER_WORKER],
  [AGENT_TOOL.GREP]: [CODER, CODER_WORKER],
  [AGENT_TOOL.APPLY_PATCH]: [CODER],
  [AGENT_TOOL.DELEGATE]: [CODER],
  [AGENT_TOOL.EDIT_PLAN]: [CODER],
  [AGENT_TOOL.WRITE_TODOS]: [CODER],
  [AGENT_TOOL.POST_TO_INBOX]: [CODER],
  [AGENT_TOOL.CLOSE_INBOX_ITEM]: [CODER],
  [AGENT_TOOL.READ_INBOX]: [CODER],
  [AGENT_TOOL.LOAD_SKILL]: [PLANNER, CODER],
  [AGENT_TOOL.SHOW_PAGE]: [PLANNER, CODER],
} as const satisfies { readonly [Tool in AgentTool]: readonly AgentRole[] };

/** The tools a role is offered, in the registry's order. */
export function toolsOf(role: AgentRole): ReadonlySet<AgentTool> {
  return new Set(
    Object.values(AGENT_TOOL).filter((tool) => {
      const roles: readonly AgentRole[] = TOOL_ROLES[tool];
      return roles.includes(role);
    }),
  );
}
