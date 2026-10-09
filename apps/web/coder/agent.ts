import { Effect, Result } from "effect";
import { defineAgent, defineDynamic } from "eve";
import { runWeb } from "../server/runtime.js";
import { host, seams } from "./host.js";
import { scriptedModel } from "./scripted-model.js";

/**
 * Luke's coding agent, as an eve agent. eve's default tools are off and the
 * tools it runs are authored one file each under `tools/`, so the set is
 * exactly the one the store writer registers (`server/hosted/coder-host/tool-set.ts`):
 * its shell and file tools, the code extension's patch and search, and the
 * provider-run web reads. No subagent is declared, since the code
 * extension's worker runs on an AI Gateway model and Luke calls the
 * providers directly. The session's input tokens are uncapped, as the plan
 * decided, and compaction is eve's default. The model is chosen at every
 * step from the agent's row, so a later change to the row is the next
 * step's model, and a session has no lifetime of eve's own.
 */
export default defineAgent({
  defaultTools: false,
  limits: { maxInputTokensPerSession: false, sessionTimeoutMs: false },
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        const scripted = seams.scriptedModel() ? { model: scriptedModel() } : undefined;
        const selected = await runWeb(
          Effect.gen(function* () {
            const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
            if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
            return yield* host.model(admitted.success, scripted);
          }),
        );
        if (Result.isFailure(selected)) throw new Error(selected.failure);
        return selected.success;
      },
    },
  }),
});
