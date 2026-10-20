import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { QUEUE_QUESTION_TOOL, runQueueQuestion } from "@luke/service/tasks/queue-question";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredTurnTools } from "../host.js";

/**
 * queue_question.ts -- on a call, the agent hands the voice one question for the developer the moment it is ready.
 *
 * The brain's own `queue_question`, one implementation for both
 * (`packages/service/src/tasks/queue-question.ts`): the call does nothing as
 * it runs but read its input, because the store journals the call before it
 * runs and the voice's follow reads the question off the journal mid-turn.
 * It is offered at each turn's start on a spoken turn alone
 * (`offeredTurnTools`); on a typed one a question goes to the inbox.
 */
export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      offeredTurnTools(ctx.session.auth).has(CODER_TOOL.QUEUE_QUESTION)
        ? defineTool({
            description: QUEUE_QUESTION_TOOL.description,
            inputSchema: emitJsonSchema(QUEUE_QUESTION_TOOL.inputSchema),
            execute: async (input) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the run parses it as wire input.
              runQueueQuestion(unparsedWire(input as WireBoundaryInput)),
          })
        : null,
  },
});
