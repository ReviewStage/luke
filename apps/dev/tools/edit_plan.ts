import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import {
  EDIT_PLAN_TOOL,
  requestedNotes,
  reserveNotes,
  settleNotes,
  takenInTurn,
} from "@luke/service/agents/coder-host/plan-edit";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { ACTION_RESULT_STATUS, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { editPlanNotes, offeredPlanTools } from "../host.js";
import { planNotesTaken } from "../session-prompt.js";

/**
 * Luke's own `edit_plan`: the notetaker's notes, taken into the agent's plan
 * (`packages/service/src/agents/coder-host/plan-edit.ts`). The call reaches the store
 * through the host's door (`../host.ts`), as the delegation does, and the
 * turn's count of notes is the session's own state, pinned before anything
 * awaits (`packages/service/src/agents/brain-host/pinned-state.ts`). Note that the call's
 * notes are reserved against the cap before the save goes out and settled
 * to what was taken once it answers, because calls one step makes run at
 * once, and each must see the other's reservation. A picture's file is
 * read from the session's sandbox through the same door eve hands every
 * file tool, opened on first use, so notes alone open none. It is offered at each
 * turn's start only to an agent on a task (`taskToolsOf`), whether it was
 * handed the plan or a prompt, so one on no plan is never offered a tool it
 * would be refused.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredPlanTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.EDIT_PLAN)
        ? defineTool({
            description: EDIT_PLAN_TOOL.description,
            inputSchema: emitJsonSchema(EDIT_PLAN_TOOL.inputSchema),
            execute: async (input, toolContext) => {
              const taken = pinnedState(planNotesTaken);
              const turnId = toolContext.session.turn.id;
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              const notes = unparsedWire(input as WireBoundaryInput);
              const requested = requestedNotes(notes);
              const before = takenInTurn(taken.get(), turnId);
              taken.update((held) => reserveNotes(held, turnId, requested));
              const answer = await editPlanNotes(
                toolContext.session.auth,
                toolContext.session.id,
                notes,
                before,
                () => toolContext.getSandbox(),
              );
              const saved = answer.status === ACTION_RESULT_STATUS.ACCEPTED ? answer.taken : 0;
              taken.update((held) => settleNotes(held, turnId, requested, saved));
              return answer;
            },
          })
        : null,
  },
});
