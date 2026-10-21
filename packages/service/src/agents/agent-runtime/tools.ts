/**
 * tools.ts -- every tool Luke offers any of its agents, and the roles each one serves.
 *
 * The one registry of the agent runtime's tools:
 * each tool, named once by the name a model calls it by
 * (`@luke/features/agent-tools`, which the desktop reads its calls by too),
 * is listed here with the roles it serves (`role.ts`), and everything that would otherwise be kept
 * twice is derived from it: what each coding agent's authored tools are
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

const { CODER, CODER_WORKER } = AGENT_ROLE;

/**
 * The roles each tool serves. Note that a coding agent's worker is offered
 * only the reads of the checkout and the web, so workers run in parallel
 * without colliding and the agent alone edits. A coding agent is offered the
 * call's own tools, `queue_question`, `withdraw_question`, and `end_call`, on
 * every turn, so its tools are the same whatever kind of turn it runs, and refused off a call
 * (`../coder-host/tool-set.ts`'s `runCallTool`), since they mean something
 * only while someone is listening. `show_code` is every agent's on every
 * turn, a coding agent's where it has a repository to read
 * (`repositoryToolsOf`), and the board's two every agent's on a task
 * (`taskToolsOf`).
 */
const TOOL_ROLES = {
  [AGENT_TOOL.QUEUE_QUESTION]: [CODER],
  [AGENT_TOOL.WITHDRAW_QUESTION]: [CODER],
  [AGENT_TOOL.SHOW_CODE]: [CODER],
  [AGENT_TOOL.DRAW_ON_BOARD]: [CODER],
  [AGENT_TOOL.LOOK_AT_BOARD]: [CODER],
  [AGENT_TOOL.LOOK_AT_PICTURE]: [CODER],
  [AGENT_TOOL.LIST_AGENTS]: [CODER],
  [AGENT_TOOL.READ_AGENT]: [CODER],
  [AGENT_TOOL.MESSAGE_AGENT]: [CODER],
  [AGENT_TOOL.START_AGENT]: [CODER],
  [AGENT_TOOL.STOP_AGENT]: [CODER],
  [AGENT_TOOL.UPDATE_AGENT]: [CODER],
  [AGENT_TOOL.LIST_TASKS]: [CODER],
  [AGENT_TOOL.READ_TASK]: [CODER],
  [AGENT_TOOL.CREATE_TASK]: [CODER],
  [AGENT_TOOL.CREATE_SECTION]: [CODER],
  [AGENT_TOOL.DELETE_SECTION]: [CODER],
  [AGENT_TOOL.UPDATE_TASK]: [CODER],
  [AGENT_TOOL.LIST_MODELS]: [CODER],
  [AGENT_TOOL.END_CALL]: [CODER],
  [AGENT_TOOL.SEARCH_WEB]: [CODER, CODER_WORKER],
  [AGENT_TOOL.READ_WEB_PAGE]: [CODER, CODER_WORKER],
  [AGENT_TOOL.RUN_ON_MAC]: [CODER, CODER_WORKER],
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
  [AGENT_TOOL.WITHDRAW_ASK]: [CODER],
  [AGENT_TOOL.READ_INBOX]: [CODER],
  [AGENT_TOOL.OPEN_PULL_REQUEST]: [CODER],
  [AGENT_TOOL.LOAD_SKILL]: [CODER],
  [AGENT_TOOL.SHOW_PAGE]: [CODER],
  [AGENT_TOOL.READ_COMMENTS]: [CODER],
  [AGENT_TOOL.REPLY_TO_COMMENT]: [CODER],
  [AGENT_TOOL.RESOLVE_THREAD]: [CODER],
  [AGENT_TOOL.REOPEN_THREAD]: [CODER],
  [AGENT_TOOL.READ_PAGE]: [CODER],
  [AGENT_TOOL.SHOW_IMAGE]: [CODER, CODER_WORKER],
  [AGENT_TOOL.SLEEP]: [CODER],
  [AGENT_TOOL.POST_CHAT]: [CODER],
  [AGENT_TOOL.READ_CHAT]: [CODER],
  [AGENT_TOOL.RESOLVE_ASK]: [CODER],
  [AGENT_TOOL.EDIT_CHANNEL]: [CODER],
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
