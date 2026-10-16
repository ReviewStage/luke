import { DELEGATE_TOOL, type DelegationAsk } from "@luke/service/agents/coder-host/delegation";
import { emitJsonSchema } from "@luke/wire/effect";
import { Result } from "effect";
import {
  defineWorkflowTool,
  type WorkflowServeReceive,
  type WorkflowStepToolContext,
} from "eve/tools";
import { makeDelegation } from "../host.js";

/**
 * delegate.ts -- the agent hands one scoped task to a worker, whose answer arrives as a task result.
 *
 * A resumable task (`serve`), the shape eve gives every agent call, because
 * that is where eve lets an authored tool open a session with a declared
 * subagent and choose what the child is told: the worker is declared hidden
 * (`../subagents/worker/agent.ts`), so the model sees this tool alone, with
 * the model and effort beside the task that eve's own subagent tool has no
 * room for. The call answers with a receipt at once and the worker's answer
 * reaches the model as a task result, so the turn stays open while it works.
 * Whether the agent waits for it is the model's to say (`background`): the
 * tool's words have it call `task_wait` unless it set the flag, which is what
 * a foreground delegation is in eve's terms. A developer's message during
 * the wait reaches the agent at once and no longer stops the worker, since a
 * task is not interrupted by a new message. A call with the task's id sends
 * the worker more, into the same session, whose child conversation stays
 * the starting call's. The pair is checked and recorded in a step, since
 * that is a side effect, as the task starts, and refused by throwing from the
 * body, since a step's failure would be retried and a refusal is final: the
 * sentence names the valid choices, so the model tries again from it. The
 * step hands the task along too, which the worker's title is generated from
 * beside its start. The answer names the pair the worker ran on and its
 * words; the child conversation the worker is recorded in is a function of
 * the starting call's id, so the transcript can be opened from the call
 * alone (`packages/service/src/agents/coder-host/host.ts`).
 */

/** The declared subagent the task goes to, by the name its directory gives it. */
const WORKER = "worker";

/** What one call carries, as the tool's schema holds it (`DELEGATE_TOOL`). */
interface DelegateInput {
  readonly task: string;
  readonly model?: string;
  readonly effort?: string;
  readonly background?: boolean;
}

/** What the step answers: the pair recorded, or why the ask was refused. */
type Prepared =
  | { readonly ok: true; readonly model: string; readonly effort: string }
  | { readonly ok: false; readonly refusal: string };

async function prepareDelegation(
  ctx: Pick<WorkflowStepToolContext, "session">,
  callId: string,
  task: string,
  asked: DelegationAsk,
): Promise<Prepared> {
  "use step";
  const made = await makeDelegation(ctx.session.auth, ctx.session.id, callId, task, asked);
  if (Result.isFailure(made)) return { ok: false, refusal: made.failure };
  return { ok: true, model: made.success.model, effort: made.success.effort };
}

export default defineWorkflowTool({
  description: DELEGATE_TOOL.description,
  inputSchema: emitJsonSchema(DELEGATE_TOOL.inputSchema),
  async serve(receive: WorkflowServeReceive<DelegateInput>, ctx) {
    "use workflow";
    const first = await receive();
    const prepared = await prepareDelegation(ctx, first.callId, first.input.task, {
      model: first.input.model,
      effort: first.input.effort,
    });
    if (!prepared.ok) throw new Error(prepared.refusal);
    const worker = ctx.agent(WORKER);
    let call = first;
    for (;;) {
      try {
        const response = await worker.send(call.input.task, { signal: call.abortSignal });
        const { message, status, error } = await response.result();
        if (status === "failed") {
          throw new Error(`The worker failed: ${error?.message ?? "no reason was given"}`);
        }
        ctx.reply({ model: prepared.model, effort: prepared.effort, result: message ?? "" });
      } catch (failure) {
        // A stop leaves the worker waiting for more; anything else ends it.
        if (!call.abortSignal.aborted) throw failure;
      }
      call = await receive();
    }
  },
});
