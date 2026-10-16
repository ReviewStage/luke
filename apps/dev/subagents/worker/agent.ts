import { CODER_REFUSAL } from "@luke/service/agents/coder-host/bounds";
import { defineAgent, defineDynamic } from "eve";
import { readStepStarted, selectDelegatedModel, stepTurnId } from "../../host.js";
import { delegationRecord } from "../../session-prompt.js";

/**
 * The worker: a subagent the coding agent hands one scoped slice of its work
 * to, read-only in the agent's own checkout, answering the agent's call
 * when it is done (`../../tools/delegate.ts`). It is declared hidden, so the
 * agent reaches it through that tool alone and chooses its model and effort
 * there: eve hands a resolver no lineage, so the step reads the call its
 * hook pinned and the delegation recorded under it. It authors no token
 * budget, so it runs under the agent's, which is none (`../../agent.ts`).
 */
export default defineAgent({
  description:
    "Do one read-only job in the coding agent's checkout: search, read files, run commands that change nothing, read the web, and answer whole.",
  defaultTools: false,
  tool: false,
  model: defineDynamic({
    events: {
      "step.started": (event, ctx) => {
        // Read before anything awaits, since the state is this session's and a statement can hand the fiber back in another's context.
        const { parentCallId } = delegationRecord.get();
        if (parentCallId === undefined) throw new Error(CODER_REFUSAL.NO_DELEGATION_PINNED);
        return selectDelegatedModel(
          ctx.session.auth,
          ctx.session.id,
          parentCallId,
          stepTurnId(ctx.session.id, readStepStarted(event)),
        );
      },
    },
  }),
});
