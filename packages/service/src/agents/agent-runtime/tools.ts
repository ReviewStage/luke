/**
 * tools.ts -- every tool Luke offers any of its agents, and the roles each one serves.
 *
 * The one registry of the agent runtime's tools (`docs/proposals/one-agent-runtime.md`):
 * each tool, named once by the name a model calls it by
 * (`@luke/features/agent-tools`, which the desktop reads its calls by too),
 * is listed here with the roles it serves (`role.ts`), and everything that would otherwise be kept
 * twice is derived from it: what each planning agent is offered
 * (`../brain-host/planning.ts`), what each coding agent's authored tools are
 * (`../coder-host/tool-set.ts`, held to the files under `apps/dev/tools/` by
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

import { AGENT_TOOL, type AgentTool } from "@luke/features/agent-tools";
import { AGENT_ROLE, type AgentRole } from "./role.js";

export { AGENT_TOOL, type AgentTool };

const { PLANNER, PLANNER_WORKER, CODER, CODER_WORKER } = AGENT_ROLE;

/**
 * The roles each tool serves. Note that a planning worker is offered only the
 * reads, never a tool that speaks, shows, or draws, because what reaches the
 * developer reaches them through the planning turn the voice follows; and a
 * coding agent's worker only the reads of the checkout and the web, so
 * workers run in parallel without colliding and the agent alone edits.
 */
const TOOL_ROLES = {
  [AGENT_TOOL.QUEUE_QUESTION]: [PLANNER],
  [AGENT_TOOL.WITHDRAW_QUESTION]: [PLANNER],
  [AGENT_TOOL.SHOW_CODE]: [PLANNER],
  [AGENT_TOOL.RUN_IN_REPOSITORY]: [PLANNER, PLANNER_WORKER],
  [AGENT_TOOL.DRAW_ON_BOARD]: [PLANNER],
  [AGENT_TOOL.LOOK_AT_BOARD]: [PLANNER],
  [AGENT_TOOL.LOOK_AT_PICTURE]: [PLANNER, CODER],
  [AGENT_TOOL.LIST_AGENTS]: [PLANNER, CODER],
  [AGENT_TOOL.READ_AGENT]: [PLANNER],
  [AGENT_TOOL.MESSAGE_AGENT]: [PLANNER, CODER],
  [AGENT_TOOL.START_AGENT]: [PLANNER, CODER],
  [AGENT_TOOL.LIST_TASKS]: [PLANNER, CODER],
  [AGENT_TOOL.END_CALL]: [PLANNER],
  [AGENT_TOOL.SEARCH_WEB]: [PLANNER, PLANNER_WORKER, CODER, CODER_WORKER],
  [AGENT_TOOL.READ_WEB_PAGE]: [PLANNER, PLANNER_WORKER, CODER, CODER_WORKER],
  [AGENT_TOOL.RUN_ON_MAC]: [PLANNER, PLANNER_WORKER, CODER, CODER_WORKER],
  [AGENT_TOOL.BASH]: [CODER, CODER_WORKER],
  [AGENT_TOOL.READ_FILE]: [CODER, CODER_WORKER],
  [AGENT_TOOL.WRITE_FILE]: [CODER],
  [AGENT_TOOL.GLOB]: [CODER, CODER_WORKER],
  [AGENT_TOOL.GREP]: [CODER, CODER_WORKER],
  [AGENT_TOOL.APPLY_PATCH]: [CODER],
  [AGENT_TOOL.DELEGATE]: [PLANNER, CODER],
  [AGENT_TOOL.EDIT_PLAN]: [CODER],
  [AGENT_TOOL.WRITE_TODOS]: [CODER],
  [AGENT_TOOL.POST_TO_INBOX]: [CODER],
  [AGENT_TOOL.CLOSE_INBOX_ITEM]: [CODER],
  [AGENT_TOOL.READ_INBOX]: [CODER],
  [AGENT_TOOL.OPEN_PULL_REQUEST]: [CODER],
  [AGENT_TOOL.LOAD_SKILL]: [PLANNER, CODER],
  [AGENT_TOOL.SHOW_PAGE]: [PLANNER, CODER],
  [AGENT_TOOL.SHOW_IMAGE]: [CODER, CODER_WORKER],
  [AGENT_TOOL.SLEEP]: [CODER],
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
