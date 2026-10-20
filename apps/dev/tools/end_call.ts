import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { END_CALL_TOOL, runEndCall } from "@luke/service/tasks/end-call";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredTurnTools } from "../host.js";

/**
 * end_call.ts -- on a call, the agent hangs up once the developer is done.
 *
 * The brain's own `end_call`, one implementation for both
 * (`packages/service/src/tasks/end-call.ts`): carried to the voice by its
 * journaled call, and ending its turn with no model step after it
 * (`endsTurn`), since the voice is already saying goodbye. It is offered on
 * a spoken turn alone (`offeredTurnTools`).
 */
export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      offeredTurnTools(ctx.session.auth).has(CODER_TOOL.END_CALL)
        ? defineTool({
            description: END_CALL_TOOL.description,
            inputSchema: emitJsonSchema(END_CALL_TOOL.inputSchema),
            endsTurn: END_CALL_TOOL.endsTurn,
            execute: async (input) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the run parses it as wire input.
              runEndCall(unparsedWire(input as WireBoundaryInput)),
          })
        : null,
  },
});
