import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LIST_MODELS_TOOL } from "@luke/service/agents/coding-agent-tools";
import { agentToolFor } from "../host.js";

/**
 * list_models.ts -- the agent lists the models and efforts it may start an agent on, and its member's default.
 *
 * The planning model's own `list_models` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`), read from the one
 * source `start_agent` checks a choice against, so a model it lists is one a
 * start takes. The call reaches the catalog through the host's door
 * (`../host.ts`), under the member the agent's session was admitted for.
 */
export default agentToolFor(CODER_TOOL.LIST_MODELS, LIST_MODELS_TOOL);
