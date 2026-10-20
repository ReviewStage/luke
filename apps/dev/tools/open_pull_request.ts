import { OPEN_PULL_REQUEST_TOOL } from "@luke/service/agents/coder-host/pull-request";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { deepenCheckout, offeredRepositoryTools, runPullRequestTool } from "../host.js";

/**
 * open_pull_request.ts -- the agent's pull request, opened by the service as the developer it writes as, or as the App.
 *
 * The call reaches the service through the host's door (`../host.ts`), as
 * `edit_plan` does, which opens the pull request on GitHub with the
 * developer's own token where the agent writes as them
 * (`packages/service/src/agents/coder-host/pull-request.ts`), so that token
 * never stands at the sandbox's firewall. The session's checkout is
 * deepened first where it still stands shallow (`deepenCheckout`), as every
 * write's is, so the branch the pull request is opened from stands on the
 * whole history with the write credential at the firewall. It is offered at
 * each turn's start only to an agent working in a repository
 * (`repositoryToolsOf`).
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredRepositoryTools(ctx.session.auth, ctx.session.id)).has(
        CODER_TOOL.OPEN_PULL_REQUEST,
      )
        ? defineTool({
            description: OPEN_PULL_REQUEST_TOOL.description,
            inputSchema: emitJsonSchema(OPEN_PULL_REQUEST_TOOL.inputSchema),
            execute: async (input, toolContext) => {
              await deepenCheckout(toolContext);
              return runPullRequestTool(
                toolContext.session.auth,
                toolContext.session.id,
                // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                unparsedWire(input as WireBoundaryInput),
              );
            },
          })
        : null,
  },
});
