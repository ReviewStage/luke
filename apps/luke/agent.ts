import { AGENT_EXTERNAL_DEPENDENCIES } from "@luke/service/agents/agent-runtime/build";
import { BRAIN_HOST, BRAIN_HOST_REFUSAL } from "@luke/service/agents/brain-host/bounds";
import { scriptedModel } from "@luke/service/testing/eve-scripted-model";
import { Result } from "effect";
import { defineAgent, defineDynamic } from "eve";
import type { SessionAuth } from "eve/context";
import { host, seams } from "./host.js";
import { runAgent } from "./runtime.js";

/**
 * Luke's judgment on the hosted tier, as an eve agent. eve ships a default
 * tool set that reads and writes files and runs a shell; none of it is
 * offered here, because every tool the brain has is one the brain
 * declares, beside eve's two over the account's integrations
 * (`connections/integrations.ts`). A session has no lifetime of eve's own:
 * the conversation's rows are the record, and a session rotates when the
 * host decides, never when a clock runs out. Nor has it a token budget of
 * eve's: eve's default caps a root's input tokens and hands each subagent a
 * share of what remains, and the worker's turns resend their whole context
 * every step, so an ordinary call's worker reached a budget in minutes. An
 * uncapped root delegates uncapped workers. The model is chosen per
 * inference, so the account's daily meter is spent once for each.
 */

/** How a resolver admits its session: the root's own standing, or a subagent's ownership alone. */
type Admission = (auth: SessionAuth, sessionId: string) => ReturnType<typeof host.admit>;

/**
 * The model every inference of this project runs on and the effort it is
 * asked for, the root's and each subagent's alike, chosen per inference so
 * the account's daily meter is spent once for each, under the admission the
 * session takes.
 */
export function brainModel(admit: Admission) {
  return defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        if (seams.scriptedModel()) {
          return {
            model: scriptedModel(),
            modelContextWindowTokens: BRAIN_HOST.MODEL_CONTEXT_WINDOW_TOKENS,
          };
        }
        const admitted = await runAgent(admit(ctx.session.auth, ctx.session.id));
        if (Result.isFailure(admitted)) throw new Error(admitted.failure);
        if (host.turnKindOf(ctx.session.auth) === undefined) {
          throw new Error(BRAIN_HOST_REFUSAL.NO_TURN_KIND);
        }
        const selected = host.model(admitted.success);
        if (Result.isFailure(selected)) throw new Error(selected.failure);
        return selected.success;
      },
    },
  });
}

export default defineAgent({
  defaultTools: false,
  build: { externalDependencies: [...AGENT_EXTERNAL_DEPENDENCIES] },
  limits: { maxInputTokensPerSession: false, sessionTimeoutMs: false },
  compaction: { thresholdPercent: BRAIN_HOST.COMPACTION_THRESHOLD },
  model: brainModel(host.admit),
  // Note that a finished run's history is deleted at once rather than kept under Vercel's
  // retention, because Luke reads every transcript from its own store, written while the run is
  // live; a session finishes only when it is retired (`packages/service/src/agents/retire-sessions.ts`).
  experimental: { workflow: { retention: 0 } },
});
