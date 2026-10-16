import { OPEN_PULL_REQUEST_TOOL } from "@luke/service/agents/coder-host/pull-request";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runPullRequestTool } from "../host.js";

/**
 * open_pull_request.ts -- the agent's pull request, opened by the service as the developer it writes as, or as the App.
 *
 * The call reaches the service through the host's door (`../host.ts`), as
 * `edit_plan` does, which opens the pull request on GitHub with the
 * developer's own token where the agent writes as them
 * (`packages/service/src/agents/coder-host/pull-request.ts`), so that token
 * never stands at the sandbox's firewall.
 */
export default defineTool({
  description: OPEN_PULL_REQUEST_TOOL.description,
  inputSchema: emitJsonSchema(OPEN_PULL_REQUEST_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runPullRequestTool(ctx.session.auth, ctx.session.id, unparsedWire(input as WireBoundaryInput)),
});
