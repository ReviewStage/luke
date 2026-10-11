import { emitJsonSchema } from "@sidecar/wire/effect";
import { Result } from "effect";
import { defineWorkflowTool, type WorkflowStepToolContext } from "eve/tools";
import { DELEGATE_TOOL, type DelegationAsk } from "../../server/hosted/coder-host/delegation.js";
import { makeDelegation } from "../host.js";

/**
 * delegate.ts -- the agent hands one scoped task to a worker and waits for its answer.
 *
 * A workflow tool, because that is where eve lets an authored tool open a
 * session with a declared subagent and choose what the child is told: the
 * worker is declared hidden (`../subagents/worker/agent.ts`), so the model
 * sees this tool alone, with the model and effort beside the task that
 * eve's own subagent tool has no room for. The call blocks the turn until
 * the worker answers, as the plan decided; calls the model makes in one
 * step run at once. The pair is checked and recorded in a step, since that
 * is a side effect, and refused by throwing from the body, since a step's
 * failure would be retried and a refusal is final: the sentence names the
 * valid choices, so the model tries again from it. The output names the
 * pair the worker ran on and its answer; the child conversation the worker
 * is recorded in is a function of this call's id, so the transcript can be
 * opened from the call alone (`server/hosted/coder-host/host.ts`).
 */

/** The declared subagent the task goes to, by the name its directory gives it. */
const WORKER = "worker";

/** What the step answers: the pair recorded, or why the ask was refused. */
type Prepared =
  | { readonly ok: true; readonly model: string; readonly effort: string }
  | { readonly ok: false; readonly refusal: string };

async function prepareDelegation(
  ctx: WorkflowStepToolContext,
  asked: DelegationAsk,
): Promise<Prepared> {
  "use step";
  const made = await makeDelegation(ctx.session.auth, ctx.session.id, ctx.callId, asked);
  if (Result.isFailure(made)) return { ok: false, refusal: made.failure };
  return { ok: true, model: made.success.model, effort: made.success.effort };
}

export default defineWorkflowTool({
  description: DELEGATE_TOOL.description,
  inputSchema: emitJsonSchema(DELEGATE_TOOL.inputSchema),
  async execute(input: { task: string; model?: string; effort?: string }, ctx) {
    "use workflow";
    const prepared = await prepareDelegation(ctx, { model: input.model, effort: input.effort });
    if (!prepared.ok) throw new Error(prepared.refusal);
    const response = await ctx.agent(WORKER).send(input.task, { signal: ctx.abortSignal });
    const { message, status, error } = await response.result();
    if (status === "failed") {
      throw new Error(`The worker failed: ${error?.message ?? "no reason was given"}`);
    }
    return { model: prepared.model, effort: prepared.effort, result: message ?? "" };
  },
});
