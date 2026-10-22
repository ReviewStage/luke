/**
 * end_call.ts -- on a call, the agent hangs up once the developer is done.
 *
 * The brain's own `end_call`, one implementation for both
 * (`packages/service/src/tasks/end-call.ts`): carried to the voice by its
 * journaled call, and ending its turn with no model step after it once it
 * is accepted (`endsTurn`), since the voice is already saying goodbye. It
 * is offered on every turn and refused off a call (`callTool`), where it
 * ends nothing, the turn included.
 */

import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { END_CALL_TOOL, runEndCall } from "@luke/service/tasks/end-call";
import { ACTION_RESULT_STATUS, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { callTool } from "../host.js";

export default defineTool({
  description: END_CALL_TOOL.description,
  inputSchema: emitJsonSchema(END_CALL_TOOL.inputSchema),
  execute: async (input, toolContext) =>
    callTool(toolContext.session.auth, CODER_TOOL.END_CALL, () =>
      // SAFETY: eve hands a tool the JSON object the model emitted; the run parses it as wire input.
      runEndCall(unparsedWire(input as WireBoundaryInput)),
    ),
  endsTurn: (output) => output.status === ACTION_RESULT_STATUS.ACCEPTED,
});
