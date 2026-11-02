import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { DELETE_SECTION_TOOL } from "@luke/service/agents/task-section-tools";
import { agentToolFor } from "../host.js";

/**
 * delete_section.ts -- the agent deletes a sidebar section of the member who started it, its tasks back under Tasks.
 *
 * The planning model's own `delete_section` too, one implementation for both
 * (`packages/service/src/agents/task-section-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the sections of the member who started it.
 */
export default agentToolFor(CODER_TOOL.DELETE_SECTION, DELETE_SECTION_TOOL);
