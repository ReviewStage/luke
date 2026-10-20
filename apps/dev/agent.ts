import { AGENT_EXTERNAL_DEPENDENCIES } from "@luke/service/agents/agent-runtime/build";
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { scriptedModel } from "@luke/service/testing/coder-scripted-model";
import { Effect, Result } from "effect";
import { defineAgent, defineDynamic } from "eve";
import { host, readStepStarted, seams, stepTurnId } from "./host.js";
import { runAgent } from "./runtime.js";

/**
 * Luke's coding agent, as an eve agent. eve's default tools are off and the
 * tools it runs are authored under `tools/`, a file each where eve needs one
 * and a few maps by family for the rest, so the set is
 * exactly the one the store writer registers (`packages/service/src/agents/coder-host/tool-set.ts`):
 * its shell and file tools, the code extension's patch and search, the
 * provider-run web reads, the delegation to its own declared worker, and
 * eve's two tools over the account's integrations (`connections/integrations.ts`).
 * The session's input tokens are uncapped, as the plan
 * decided, and compaction runs at eve's default share of the window, named
 * where the agent's tab reads it too. The model is chosen at every
 * step from the agent's row, so a later change to the row is the next
 * step's model, and a session has no lifetime of eve's own.
 */
export default defineAgent({
  defaultTools: false,
  build: { externalDependencies: [...AGENT_EXTERNAL_DEPENDENCIES] },
  compaction: { thresholdPercent: CODER.COMPACTION_THRESHOLD_SHARE },
  limits: { maxInputTokensPerSession: false, sessionTimeoutMs: false },
  // Note that a finished or failed run's history is kept for the team plan's Workflow retention
  // period (eve offers only `0` or that default), so a session that died mid-turn can still be
  // read in the Workflow dashboard. This is for diagnosing those deaths and may go back to `0`,
  // deleting the history at once, once their cause is known: Luke reads every transcript from
  // its own store, written while the run is live, and never reads this history back.
  experimental: { workflow: { retention: "default" } },
  model: defineDynamic({
    events: {
      "step.started": async (event, ctx) => {
        const scripted = seams.scriptedModel() ? { model: scriptedModel() } : undefined;
        const selected = await runAgent(
          Effect.gen(function* () {
            const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
            if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
            return yield* host.model(
              admitted.success,
              scripted,
              stepTurnId(ctx.session.id, readStepStarted(event)),
            );
          }),
        );
        if (Result.isFailure(selected)) throw new Error(selected.failure);
        return selected.success;
      },
    },
  }),
});
