import type { DatabaseServices } from "@luke/database/core/query";
import { sweepAbandonedTurns } from "@luke/database/models/abandoned-turns";
import { hostedStore } from "@luke/database/models/hosted-store";
import { recordVoiceSeconds } from "@luke/database/models/quota";
import { voiceSessionRecord } from "@luke/database/models/voice-session-record";
import { storeWriter } from "@luke/database/models/writer";
import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { EVE_MOUNT, eveSessions } from "@luke/service/agents/brain-host/eve-sessions";
import {
  sessionSandboxesLayer,
  sweepSessionSandboxes,
} from "@luke/service/agents/session-sandboxes";
import type { EveForAccount } from "@luke/service/automations/automation-runs";
import { sweepAutomations } from "@luke/service/automations/automation-sweep";
import { HostedEnvironment } from "@luke/service/environment";
import type { GitHubApp } from "@luke/service/github/github-app";
import {
  effectPassthrough,
  HOSTED_REFUSAL,
  hostedNotFoundRoute,
} from "@luke/service/http/http-effect";
import { MAINTENANCE_SWEEP_PATH } from "@luke/service/maintenance/maintenance-bounds";
import { sweepTerminalLeases } from "@luke/service/maintenance/terminal-lease-sweep";
import { HOSTED_TOOL_SET } from "@luke/service/plans/brain-tool-set";
import type { ModelCatalog } from "@luke/service/providers/model-catalog";
import { ANY_METHOD, type WebRoutes } from "@luke/service/route";
import { Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpRouter } from "effect/http";
import { handleMaintenanceSweep } from "./hosted/maintenance-sweep.js";
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
 * them on the same upstream the voice functions attach through. An
 * automation's run reaches eve as the deployment acting for the
 * automation's owner, under the same secret the cron calls with; a
 * deployment without it, or without an origin for eve, fails each run it
 * acts on as unavailable.
 */
const maintenanceSweepEffect = /* @__PURE__ */ Effect.fn("web/maintenanceSweepEffect")(function* (
  request: Request,
): Effect.fn.Return<
  Response,
  unknown,
  DatabaseServices | HostedEnvironment | HttpClient.HttpClient | GitHubApp | ModelCatalog
> {
  const environment = yield* HostedEnvironment;
  const startContext = yield* Effect.context<HttpClient.HttpClient | GitHubApp | ModelCatalog>();
  const secret = environment.cronSecret;
  const origin = deploymentEveOrigin();
  const eveFor: EveForAccount = (account) =>
    secret === undefined || origin === undefined
      ? Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)
      : eveSessions({ origin, caller: { secret, account }, mount: EVE_MOUNT.CODER });
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
    sweepTerminalLeases: (now) =>
      sweepTerminalLeases(new Date(now)).pipe(Effect.provide(sandboxes)),
    sweepAutomations: (now) =>
      sweepAutomations(eveFor, now).pipe(Effect.provideContext(startContext)),
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
  DatabaseServices | HostedEnvironment | HttpClient.HttpClient | GitHubApp | ModelCatalog
> {
  return Layer.mergeAll(
    // `ANY_METHOD`, not `GET`: the handler decides its own method refusal, so a
    // request to the right path on the wrong method still answers 405 rather
    // than falling through to the group's own 404.
    HttpRouter.add(ANY_METHOD, MAINTENANCE_SWEEP_PATH, effectPassthrough(maintenanceSweepEffect)),
    hostedNotFoundRoute,
  );
}
