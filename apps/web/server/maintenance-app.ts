import { sweepAbandonedTurns } from "@sidecar/database/models/abandoned-turns";
import { hostedStore } from "@sidecar/database/models/hosted-store";
import { recordVoiceSeconds } from "@sidecar/database/models/quota";
import { voiceSessionRecord } from "@sidecar/database/models/voice-session-record";
import { storeWriter } from "@sidecar/database/models/writer";
import { Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpRouter } from "effect/http";
import type { SqlClient } from "effect/sql";
import { HOSTED_TOOL_SET } from "./hosted/brain-tool-set.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { effectPassthrough, hostedNotFoundRoute } from "./hosted/http-effect.js";
import { MAINTENANCE_SWEEP_PATH } from "./hosted/maintenance-bounds.js";
import { handleMaintenanceSweep } from "./hosted/maintenance-sweep.js";
import { sessionSandboxesLayer, sweepSessionSandboxes } from "./hosted/session-sandboxes.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";
import { createLiveUpstream } from "./voice/openai.js";
import {
  NOTHING_ORPHANED,
  sweepVoiceOrphans,
  VOICE_ORPHAN_SWEEP,
  VOICE_SESSION_LIMIT_MS,
} from "./voice/orphan-sweep.js";

/**
 * The maintenance group: the scheduled sweep's one entry, called by Vercel's
 * cron on the cadence `vercel.json` fixes. The logic lives in
 * `server/hosted/maintenance-sweep.ts`; this hands it the deployment's real
 * seams and the database queries behind them, each answering an Effect over
 * the group's own `SqlClient.SqlClient`. A deployment without the voice key
 * sweeps no detached voice session, since it opened none; one with it ends
 * them on the same upstream the voice functions attach through.
 */
const maintenanceSweepEffect = /* @__PURE__ */ Effect.fn("web/maintenanceSweepEffect")(function* (
  request: Request,
): Effect.fn.Return<
  Response,
  unknown,
  SqlClient.SqlClient | HostedEnvironment | HttpClient.HttpClient
> {
  const environment = yield* HostedEnvironment;
  const sandboxes = Layer.provide(
    sessionSandboxesLayer,
    Layer.succeed(HttpClient.HttpClient, yield* HttpClient.HttpClient),
  );
  const voiceUpstream = environment.openAiKey
    ? createLiveUpstream({
        apiKey: Redacted.value(environment.openAiKey),
        attachTimeoutMs: VOICE_ORPHAN_SWEEP.ATTACH_TIMEOUT_MS,
      })
    : undefined;
  return yield* handleMaintenanceSweep({
    request,
    cronSecret: environment.cronSecret,
    purgeCleared: (now) => hostedStore().retention.purgeCleared(new Date(now)),
    // A call started longer ago than OpenAI's own limit has ended, whether or not its row was closed.
    purgeDeletedPlanCalls: (now) =>
      hostedStore().retention.purgeDeletedPlanCalls(new Date(now - VOICE_SESSION_LIMIT_MS)),
    sweepAbandonedTurns: (now) =>
      Effect.flatMap(storeWriter({ tools: HOSTED_TOOL_SET }), (writer) =>
        sweepAbandonedTurns({ writer }, { now }),
      ),
    sweepSandboxes: (now) => sweepSessionSandboxes(new Date(now)).pipe(Effect.provide(sandboxes)),
    sweepVoice: (now) =>
      voiceUpstream === undefined
        ? Effect.succeed(NOTHING_ORPHANED)
        : sweepVoiceOrphans(
            {
              upstream: voiceUpstream,
              record: voiceSessionRecord(),
              recordSeconds: (input) =>
                Effect.suspend(() => recordVoiceSeconds({ ...input, now: Date.now() })),
            },
            { now },
          ),
  });
});

/**
 * The group: the sweep carried to an `HttpApp`, and the hosted vocabulary's
 * own refusal for a path it does not declare — unreachable in production,
 * since `vercel.json` sends the function only its own path.
 */
export function maintenanceApp(): WebRoutes<
  SqlClient.SqlClient | HostedEnvironment | HttpClient.HttpClient
> {
  return Layer.mergeAll(
    // `ANY_METHOD`, not `GET`: the handler decides its own method refusal, so a
    // request to the right path on the wrong method still answers 405 rather
    // than falling through to the group's own 404.
    HttpRouter.add(ANY_METHOD, MAINTENANCE_SWEEP_PATH, effectPassthrough(maintenanceSweepEffect)),
    hostedNotFoundRoute,
  );
}
