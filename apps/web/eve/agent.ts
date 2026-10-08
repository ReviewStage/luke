import { Result } from "effect";
import { defineAgent, defineDynamic } from "eve";
import { BRAIN_HOST, BRAIN_HOST_REFUSAL } from "../server/hosted/brain-host/bounds.js";
import { conversationSessionOf } from "../server/hosted/brain-host/host.js";
import { runWeb } from "../server/runtime.js";
import { host, seams } from "./host.js";
import { scriptedModel } from "./scripted-model.js";

/**
 * Luke's judgment on the hosted tier, as an eve agent. eve ships a default
 * tool set that reads and writes files and runs a shell; none of it is
 * offered here, because every tool the brain has is one the planning model
 * declares. A session has no lifetime of eve's own:
 * the conversation's rows are the record, and a session rotates when the
 * host decides, never when a clock runs out. The model is chosen per
 * inference, so the account's daily meter is spent once for each.
 */

/**
 * The model every inference of this project runs on, the root's and each
 * subagent's alike, chosen per inference so the account's daily meter is
 * spent once for each. A subagent's child session is admitted through the
 * root session it was delegated from (`conversationSessionOf`).
 */
export const brainModel = defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      if (seams.scriptedModel()) {
        return {
          model: scriptedModel(),
          modelContextWindowTokens: BRAIN_HOST.MODEL_CONTEXT_WINDOW_TOKENS,
        };
      }
      const admitted = await runWeb(
        host.admit(ctx.session.auth, conversationSessionOf(ctx.session)),
      );
      if (Result.isFailure(admitted)) throw new Error(admitted.failure);
      if (host.turnKindOf(ctx.session.auth) === undefined) {
        throw new Error(BRAIN_HOST_REFUSAL.NO_TURN_KIND);
      }
      const model = host.model(admitted.success);
      if (!model) throw new Error(BRAIN_HOST_REFUSAL.NO_MODEL);
      return { model, modelContextWindowTokens: BRAIN_HOST.MODEL_CONTEXT_WINDOW_TOKENS };
    },
  },
});

export default defineAgent({
  defaultTools: false,
  limits: { sessionTimeoutMs: false },
  compaction: { thresholdPercent: BRAIN_HOST.COMPACTION_THRESHOLD },
  model: brainModel,
});
