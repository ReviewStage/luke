import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { ACTION_RESULT_STATUS, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import {
  EDIT_PLAN_TOOL,
  requestedNotes,
  reserveNotes,
  settleNotes,
  takenInTurn,
} from "../../server/hosted/coder-host/plan-edit.js";
import { editPlanNotes } from "../host.js";
import { planNotesTaken } from "../session-prompt.js";

/**
 * Luke's own `edit_plan`: the notetaker's notes, taken into the agent's plan
 * (`server/hosted/coder-host/plan-edit.ts`). The call reaches the store
 * through the host's door (`../host.ts`), as the delegation does, and the
 * turn's count of notes is the session's own state, pinned before anything
 * awaits (`packages/service/src/agents/brain-host/pinned-state.ts`). Note that the call's
 * notes are reserved against the cap before the save goes out and settled
 * to what was taken once it answers, because calls one step makes run at
 * once, and each must see the other's reservation.
 */
export default defineTool({
  description: EDIT_PLAN_TOOL.description,
  inputSchema: emitJsonSchema(EDIT_PLAN_TOOL.inputSchema),
  execute: async (input, ctx) => {
    const taken = pinnedState(planNotesTaken);
    const turnId = ctx.session.turn.id;
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    const notes = unparsedWire(input as WireBoundaryInput);
    const requested = requestedNotes(notes);
    const before = takenInTurn(taken.get(), turnId);
    taken.update((held) => reserveNotes(held, turnId, requested));
    const answer = await editPlanNotes(ctx.session.auth, ctx.session.id, notes, before);
    const saved = answer.status === ACTION_RESULT_STATUS.ACCEPTED ? answer.taken : 0;
    taken.update((held) => settleNotes(held, turnId, requested, saved));
    return answer;
  },
});
