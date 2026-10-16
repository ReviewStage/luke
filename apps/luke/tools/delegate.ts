import { BRAIN_DELEGATE_TOOL } from "@luke/service/agents/brain-host/brain";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineWorkflowTool, type WorkflowServeReceive } from "eve/tools";

/**
 * delegate.ts -- the planning model hands one job to the worker, which always runs in the background.
 *
 * The one delegation every agent of Luke's makes, a resumable task (`serve`),
 * as a coding agent's is (`apps/dev/tools/delegate.ts`): the call answers
 * with a receipt at once and the worker's summary reaches the model as a
 * task result, so the planning turn stays open while it works and the voice
 * follows it there. The planning model is offered no foreground wait, since
 * that would hold the spoken turn silent for the worker's whole run. A call
 * with the task's id sends the worker more, into the same session, whose
 * child conversation stays the starting call's, which is how the Work tab
 * finds it. The worker is declared hidden (`../subagents/worker/agent.ts`),
 * so the model reaches it through this tool alone, and it runs on the
 * planning model's own model on Luke's key.
 */

/** The declared subagent the job goes to, by the name its directory gives it. */
const WORKER = "worker";

/** What one call carries, as the tool's schema holds it (`BRAIN_DELEGATE_TOOL`). */
interface DelegateInput {
  readonly task: string;
}

export default defineWorkflowTool({
  description: BRAIN_DELEGATE_TOOL.description,
  inputSchema: emitJsonSchema(BRAIN_DELEGATE_TOOL.inputSchema),
  async serve(receive: WorkflowServeReceive<DelegateInput>, ctx) {
    "use workflow";
    const worker = ctx.agent(WORKER);
    for (;;) {
      const call = await receive();
      try {
        const response = await worker.send(call.input.task, { signal: call.abortSignal });
        const { message, status, error } = await response.result();
        if (status === "failed") {
          throw new Error(`The worker failed: ${error?.message ?? "no reason was given"}`);
        }
        ctx.reply(message ?? "");
      } catch (failure) {
        // A stop leaves the worker waiting for more; anything else ends it.
        if (!call.abortSignal.aborted) throw failure;
      }
    }
  },
});
