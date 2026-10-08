import { Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { HOSTED_TOOL_SET } from "./hosted/brain-tool-set.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { effectPassthrough, hostedNotFoundRoute } from "./hosted/http-effect.js";
import { MAINTENANCE_SWEEP_PATH } from "./hosted/maintenance-bounds.js";
import { handleMaintenanceSweep } from "./hosted/maintenance-sweep.js";
import { recordVoiceSeconds } from "./hosted/quota.js";
import { sweepAbandonedTurns } from "./hosted/store/abandoned-turns.js";
import { hostedStore, storeWriter } from "./hosted/store/index.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";
import { createLiveUpstream } from "./voice/openai.js";
import { NOTHING_ORPHANED, sweepVoiceOrphans, VOICE_ORPHAN_SWEEP } from "./voice/orphan-sweep.js";
import { voiceSessionRecord } from "./voice/session-record.js";

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
): Effect.fn.Return<Response, unknown, SqlClient.SqlClient | HostedEnvironment> {
  const environment = yield* HostedEnvironment;
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
    sweepAbandonedTurns: (now) =>
      Effect.flatMap(storeWriter({ tools: HOSTED_TOOL_SET }), (writer) =>
        sweepAbandonedTurns({ writer }, { now }),
      ),
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
export function maintenanceApp(): WebRoutes<SqlClient.SqlClient | HostedEnvironment> {
  return Layer.mergeAll(
    // `ANY_METHOD`, not `GET`: the handler decides its own method refusal, so a
    // request to the right path on the wrong method still answers 405 rather
    // than falling through to the group's own 404.
    HttpRouter.add(ANY_METHOD, MAINTENANCE_SWEEP_PATH, effectPassthrough(maintenanceSweepEffect)),
    hostedNotFoundRoute,
  );
}
