import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { defineDynamic } from "eve/tools";
import { macCommandTool, offeredMacTools } from "../host.js";

/**
 * run_on_mac.ts -- a command run on the developer's own Mac (`packages/service/src/agents/mac-command.ts`).
 *
 * It is offered at each turn's start only to an agent in a sandbox of ours
 * into which no one but its starter has put words (`macToolsOf`), since the
 * door refuses every call after such words for the rest of the
 * conversation's life.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredMacTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.RUN_ON_MAC)
        ? macCommandTool()
        : null,
  },
});
