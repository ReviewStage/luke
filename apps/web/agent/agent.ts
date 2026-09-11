import { defineAgent, defineDynamic } from "eve";
import { BRAIN_HOST, BRAIN_HOST_REFUSAL } from "../server/hosted/brain-host/bounds.js";
import { productionBrainHostSeams } from "../server/hosted/brain-host/production.js";
import { host } from "./host.js";
import { scriptedModel } from "./scripted-model.js";

/**
 * Luke's judgment on the hosted tier, as an eve agent. eve ships a default
 * tool set that reads and writes files and runs a shell; none of it is
 * offered here, because the brain's workspace tools are the one place the
 * brain writes a file at all and every other tool it has is one the catalog
 * declares and the policy admits. A session has no lifetime of eve's own:
 * the conversation's rows are the record, and a session rotates when the
 * host decides, never when a clock runs out. The model is chosen per
 * inference, so the account's daily meter is spent once for each.
 */

const seams = productionBrainHostSeams();

export default defineAgent({
  defaultTools: false,
  limits: { sessionTimeoutMs: false },
  compaction: { thresholdPercent: BRAIN_HOST.COMPACTION_THRESHOLD },
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        if (seams.scriptedModel()) {
          return {
            model: scriptedModel(),
            modelContextWindowTokens: BRAIN_HOST.MODEL_CONTEXT_WINDOW_TOKENS,
          };
        }
        const admitted = await host.admit(ctx.session.auth, ctx.session.id);
        if (!admitted.ok) throw new Error(admitted.refusal);
        if (host.turnKindOf(ctx.session.auth) === undefined) {
          throw new Error(BRAIN_HOST_REFUSAL.NO_TURN_KIND);
        }
        const model = host.model(admitted);
        if (!model) throw new Error(BRAIN_HOST_REFUSAL.NO_MODEL);
        return { model, modelContextWindowTokens: BRAIN_HOST.MODEL_CONTEXT_WINDOW_TOKENS };
      },
    },
  }),
});
