/**
 * tools.ts -- every tool we name to any of our agents, by the name a model calls it by.
 *
 * The one registry of the agent runtime's tools' names: each tool, named
 * once by the name a model calls it by (`@repo/features/agent-tools`, which
 * the desktop reads its calls by too). The set the store writer holds a
 * coding agent's rows to is built from it (`../coder-host/tool-set.ts`), the
 * calls of tools only the retired runtime's agents were offered among them; which of them an
 * agent is served is the catalog's (`../tool-catalog/catalog.ts`). The tools
 * the retired runtime injected of its own beside a task or a connection (`task_wait`,
 * `task_cancel`, `connection_search`, `connection_execute`) and a declared
 * subagent's own tool were its, not ours, and are not listed.
 *
 * This module is a leaf: a tool's module takes its name from here, so the
 * registry imports no tool and no host, and every module may import it.
 */

import { AGENT_TOOL } from "@repo/features/agent-tools";

export { AGENT_TOOL };
