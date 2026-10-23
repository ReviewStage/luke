import { LIST_AUTOMATIONS_TOOL } from "@luke/service/agents/automation-tools";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { agentToolFor } from "../host.js";

/**
 * list_automations.ts -- the agent lists its workspace's automations, or reads one whole with its newest runs.
 *
 * One implementation for every runtime
 * (`packages/service/src/agents/automation-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the automations of its workspace as the
 * member who started it.
 */
export default agentToolFor(CODER_TOOL.LIST_AUTOMATIONS, LIST_AUTOMATIONS_TOOL);
