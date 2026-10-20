import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { RUN_ON_MAC_TOOL } from "@luke/service/agents/mac-command";
import { READ_WEB_PAGE_TOOL, SEARCH_WEB_TOOL } from "@luke/service/agents/public-research";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { host, runMacCommand, runResearchTool } from "../host.js";

/**
 * reach.ts -- the agent's reach past its sandbox: the brain's own public search and page read, under the turn's budget, and a command run on the developer's own Mac.
 *
 * The public pair is the brain's (`packages/service/src/agents/public-research.ts`)
 * and `run_on_mac` goes through the one door every agent's call goes through
 * (`packages/service/src/agents/mac-command.ts`), each under the admission
 * the agent's model runs under (`host.admit`). One file for all three, on
 * the terms `workspace.ts` gives: resolved once a session starts, reading
 * nothing, each tool named by its key.
 */
export default defineDynamic({
  events: {
    "session.started": async () => ({
      [CODER_TOOL.READ_WEB_PAGE]: defineTool({
        description: READ_WEB_PAGE_TOOL.description,
        inputSchema: emitJsonSchema(READ_WEB_PAGE_TOOL.inputSchema),
        execute: async (input, ctx) =>
          runResearchTool(
            host.admit,
            CODER_TOOL.READ_WEB_PAGE,
            { auth: ctx.session.auth, sessionId: ctx.session.id, turnId: ctx.session.turn.id },
            // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
            unparsedWire(input as WireBoundaryInput),
          ),
      }),
      [CODER_TOOL.RUN_ON_MAC]: defineTool({
        description: RUN_ON_MAC_TOOL.description,
        inputSchema: emitJsonSchema(RUN_ON_MAC_TOOL.inputSchema),
        execute: (input, ctx) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the door parses it as wire input.
          runMacCommand(
            host.admit,
            ctx.session.auth,
            ctx.session.id,
            unparsedWire(input as WireBoundaryInput),
          ),
      }),
      [CODER_TOOL.SEARCH_WEB]: defineTool({
        description: SEARCH_WEB_TOOL.description,
        inputSchema: emitJsonSchema(SEARCH_WEB_TOOL.inputSchema),
        execute: async (input, ctx) =>
          runResearchTool(
            host.admit,
            CODER_TOOL.SEARCH_WEB,
            { auth: ctx.session.auth, sessionId: ctx.session.id, turnId: ctx.session.turn.id },
            // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
            unparsedWire(input as WireBoundaryInput),
          ),
      }),
    }),
  },
});
