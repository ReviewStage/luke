import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { CREATE_SECTION_TOOL } from "@luke/service/agents/task-section-tools";
import { agentToolFor } from "../host.js";

/**
 * create_section.ts -- the agent makes a section in its workspace's sidebar, for the member who started it, to keep tasks in.
 *
 * The planning model's own `create_section` too, one implementation for both
 * (`packages/service/src/agents/task-section-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the sections of the member who started it.
 */
export default agentToolFor(CODER_TOOL.CREATE_SECTION, CREATE_SECTION_TOOL);
