import { Effect } from "effect";
import { runWeb } from "../../../runtime.js";
import { HostedEnvironment, hostedEnvironment } from "../../environment.js";
import { storeWriter } from "../../store/index.js";
import { openProductionConversation } from "./harness-production.js";
import {
  type HarnessServices,
  type HarnessSessionsSeams,
  harnessSessions,
} from "./harness-sessions.js";
import { CODER_HARNESS_VARIABLE, CODER_RUNTIME, coderRuntimeOf } from "./runtime-flag.js";
import { HARNESS_TOOL_SET } from "./tool-vocabulary.js";

/**
 * compose.ts -- SPIKE (do not merge): the harness path composed for a route, where the flag names a harness, and nothing where it does not.
 *
 * An edge on the same terms as `coder/host.ts`: the environment is read
 * once with `Effect.runSync`, since its read suspends on nothing, and the
 * web's runner is handed down for the plan-notes tool, which the harness
 * calls as a promise. The parked sessions and the turns under way are this
 * instance's own maps, which is exactly what a real build would replace
 * with a table and a durable driver: a turn is a detached fiber here, and
 * on Vercel a fiber past the response lives only as long as the function
 * is kept alive (`waitUntil`, at most the function's maximum duration).
 */
export function harnessFromEnvironment():
  | ((userId: string) => ReturnType<typeof harnessSessions>)
  | undefined {
  const runtime = coderRuntimeOf(process.env[CODER_HARNESS_VARIABLE]);
  if (runtime === CODER_RUNTIME.EVE) return undefined;
  const keys = Effect.runSync(
    Effect.provide(
      Effect.map(HostedEnvironment, (environment) => ({
        anthropic: environment.anthropicKey,
        openAi: environment.openAiKey,
      })),
      hostedEnvironment,
    ),
  );
  const seams: HarnessSessionsSeams = {
    runtime,
    openConversation: openProductionConversation(runtime, () => keys, runWeb),
    parked: new Map(),
    running: new Map(),
    writer: () => storeWriter({ tools: HARNESS_TOOL_SET }),
    now: () => Date.now(),
    fork: (turn: Effect.Effect<void, never, HarnessServices>) =>
      Effect.asVoid(Effect.forkDetach(turn)),
  };
  return (userId) => harnessSessions(seams, userId);
}
