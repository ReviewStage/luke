import { BRAIN_EDIT_PLAN_TOOL } from "@luke/service/agents/brain-host/plan-edit";
import type { PlanEditResult } from "@luke/service/agents/coder-host/plan-edit";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineWorkflowTool, type WorkflowStepToolContext } from "eve/tools";
import { editPlanNotes } from "../host.js";

/**
 * edit_plan.ts -- the planning model writes the plan itself, in the background.
 *
 * Every call runs as a task (`task`): the model is handed a receipt at once,
 * which is not the save, and goes on researching and speaking while the
 * notes are taken; what the save came to reaches it as the task's result, so
 * a note that missed is written again over the plan as it then stands. The
 * save is one step, a side effect, run under the session the call was made
 * in (`editPlanNotes`): the plan and the account are read off that session,
 * never off the model's input. The step answers a refusal rather than
 * throwing it, because a step that throws is run again. A call cancelled
 * before its step began saves nothing; one whose save already landed stays
 * saved. The tool is the root's alone, since no declared subagent inherits a
 * root tool, and it is authored here rather than offered by the dynamic
 * resolver (`./brain.ts`), which offers only the host's declarations.
 */

async function saveNotesStep(
  ctx: Pick<WorkflowStepToolContext, "session">,
  input: WireBoundaryInput,
): Promise<PlanEditResult> {
  "use step";
  return await editPlanNotes(ctx.session.auth, ctx.session.id, unparsedWire(input));
}

export default defineWorkflowTool({
  description: BRAIN_EDIT_PLAN_TOOL.description,
  inputSchema: emitJsonSchema(BRAIN_EDIT_PLAN_TOOL.inputSchema),
  async task(input: WireBoundaryInput, ctx) {
    "use workflow";
    if (ctx.abortSignal.aborted) throw new Error("The save was cancelled before it began.");
    return await saveNotesStep(ctx, input);
  },
});
