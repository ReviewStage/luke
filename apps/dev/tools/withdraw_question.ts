/**
 * withdraw_question.ts -- on a call, the agent takes back a question an answer made moot, before the voice asks it.
 *
 * The brain's own `withdraw_question`, one implementation for both
 * (`packages/service/src/tasks/queue-question.ts`), carried to the voice by
 * its journaled call as `queue_question` is. It is offered on every turn
 * and refused off a call (`callTool`).
 */

import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { runWithdrawQuestion, WITHDRAW_QUESTION_TOOL } from "@luke/service/tasks/queue-question";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { callTool } from "../host.js";

export default defineTool({
  description: WITHDRAW_QUESTION_TOOL.description,
  inputSchema: emitJsonSchema(WITHDRAW_QUESTION_TOOL.inputSchema),
  execute: async (input, toolContext) =>
    callTool(toolContext.session.auth, CODER_TOOL.WITHDRAW_QUESTION, () =>
      // SAFETY: eve hands a tool the JSON object the model emitted; the run parses it as wire input.
      runWithdrawQuestion(unparsedWire(input as WireBoundaryInput)),
    ),
});
