/**
 * queue_question.ts -- on a call, the agent hands the voice one question for the developer the moment it is ready.
 *
 * The brain's own `queue_question`, one implementation for both
 * (`packages/service/src/tasks/queue-question.ts`): the call does nothing as
 * it runs but read its input, because the store journals the call before it
 * runs and the voice's follow reads the question off the journal mid-turn.
 * It is offered on every turn, so the tools a turn sends are the same
 * whatever its kind, and refused off a call (`callTool`), where a question
 * goes to the inbox.
 */

import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { QUEUE_QUESTION_TOOL, runQueueQuestion } from "@luke/service/tasks/queue-question";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { callTool } from "../host.js";

export default defineTool({
  description: QUEUE_QUESTION_TOOL.description,
  inputSchema: emitJsonSchema(QUEUE_QUESTION_TOOL.inputSchema),
  execute: async (input, toolContext) =>
    callTool(toolContext.session.auth, CODER_TOOL.QUEUE_QUESTION, () =>
      // SAFETY: eve hands a tool the JSON object the model emitted; the run parses it as wire input.
      runQueueQuestion(unparsedWire(input as WireBoundaryInput)),
    ),
});
