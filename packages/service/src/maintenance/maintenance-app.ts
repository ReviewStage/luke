import type { DatabaseServices } from "@luke/database/core/query";
import { sweepAbandonedTurns } from "@luke/database/models/abandoned-turns";
import { hostedStore } from "@luke/database/models/hosted-store";
import { purgeUnsavedAttachments } from "@luke/database/models/plan-attachments";
import { recordVoiceSeconds } from "@luke/database/models/quota";
import { voiceSessionRecord } from "@luke/database/models/voice-session-record";
import { storeWriter } from "@luke/database/models/writer";
import { Clock, Effect, Exit, Layer, Redacted } from "effect";
import { HttpClient, HttpRouter } from "effect/http";
import { deploymentEveOrigin } from "../agents/brain-host/eve-origin.js";
import { EVE_MOUNT, eveSessions } from "../agents/brain-host/eve-sessions.js";
import { sessionSandboxesLayer, sweepSessionSandboxes } from "../agents/session-sandboxes.js";
import type { EveForAccount } from "../automations/automation-runs.js";
import { sweepAutomations } from "../automations/automation-sweep.js";
import { HostedEnvironment } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";
import { effectPassthrough, HOSTED_REFUSAL, hostedNotFoundRoute } from "../http/http-effect.js";
import {
  CHECK_IN_STATUS,
  type CheckInStatus,
  type CronMonitor,
  ErrorReports,
} from "../observability/error-reports.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";
import { createLiveUpstream } from "../voice/openai.js";
import {
  NOTHING_ORPHANED,
  sweepVoiceOrphans,
  VOICE_ORPHAN_SWEEP,
  VOICE_SESSION_LIMIT_MS,
} from "../voice/orphan-sweep.js";
import { MAINTENANCE_SWEEP, MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";
import { handleMaintenanceSweep } from "./maintenance-sweep.js";
import { sweepTerminalLeases } from "./terminal-lease-sweep.js";

/** The sweep as Sentry's monitor watches it: a minute missed, late, or failed three times in a row opens an issue. */
const SWEEP_MONITOR: CronMonitor = {
  slug: "maintenance-sweep",
  crontab: MAINTENANCE_SWEEP.CRONTAB,
  maxRuntimeMinutes: MAINTENANCE_SWEEP.MAX_DURATION_SECONDS / 60,
};

/** How long a picture pasted into a plan waits for a save to name it before the sweep deletes it: a day, so an edit left open over lunch keeps its pictures. */
const UNSAVED_PICTURE_GRACE_MS = 24 * 60 * 60 * 1_000;

/**
 * The maintenance group: the scheduled sweep's one entry, called by Vercel's
 * cron on the cadence `vercel.json` fixes. The logic lives in
 * `maintenance/maintenance-sweep.ts`; this hands it the deployment's real
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
    purgeDeletedTaskCalls: (now) =>
      hostedStore().retention.purgeDeletedTaskCalls(new Date(now - VOICE_SESSION_LIMIT_MS)),
    sweepAbandonedTurns: (now) =>
      Effect.flatMap(storeWriter({ tools: HOSTED_TOOL_SET }), (writer) =>
        sweepAbandonedTurns({ writer }, { now }),
      ),
    sweepSandboxes: (now) => sweepSessionSandboxes(new Date(now)).pipe(Effect.provide(sandboxes)),
    sweepTerminalLeases: (now) =>
      sweepTerminalLeases(new Date(now)).pipe(Effect.provide(sandboxes)),
    sweepAutomations: (now) =>
      sweepAutomations(eveFor, now).pipe(Effect.provideContext(startContext)),
    purgeUnsavedPictures: (now) =>
      purgeUnsavedAttachments(new Date(now - UNSAVED_PICTURE_GRACE_MS)),
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
 * What a sweep's end tells its monitor: a sweep that ran answers 200, and one
 * the deployment could not run (no `CRON_SECRET`) answers 503, which is the
 * monitor's to hear as a failure; a call that was not Vercel's cron (a wrong
 * bearer, a wrong method) is not a run and tells it nothing.
 */
function sweepCheckIn(exit: Exit.Exit<Response, unknown>): CheckInStatus | undefined {
  if (Exit.isFailure(exit)) return CHECK_IN_STATUS.ERROR;
  if (exit.value.ok) return CHECK_IN_STATUS.OK;
  return exit.value.status >= 500 ? CHECK_IN_STATUS.ERROR : undefined;
}

/** The sweep with its check-in: the run's end and its length, told to Sentry, then the run's own answer or failure. */
const monitoredSweepEffect = /* @__PURE__ */ Effect.fn("web/monitoredSweepEffect")(function* (
  request: Request,
) {
  const reports = yield* ErrorReports;
  const started = yield* Clock.currentTimeMillis;
  const exit = yield* Effect.exit(maintenanceSweepEffect(request));
  const status = sweepCheckIn(exit);
  if (status !== undefined) {
    const ended = yield* Clock.currentTimeMillis;
    yield* reports.checkIn(SWEEP_MONITOR, status, (ended - started) / 1_000);
  }
  return yield* exit;
});

/**
 * The group: the sweep carried to an `HttpApp`, and the hosted vocabulary's
 * own refusal for a path it does not declare — unreachable in production,
 * since `vercel.json` sends the function only its own path.
 */
export function maintenanceApp(): WebRoutes<
  | DatabaseServices
  | HostedEnvironment
  | HttpClient.HttpClient
  | GitHubApp
  | ModelCatalog
  | ErrorReports
> {
  return Layer.mergeAll(
    // `ANY_METHOD`, not `GET`: the handler decides its own method refusal, so a
    // request to the right path on the wrong method still answers 405 rather
    // than falling through to the group's own 404.
    HttpRouter.add(ANY_METHOD, MAINTENANCE_SWEEP_PATH, effectPassthrough(monitoredSweepEffect)),
    hostedNotFoundRoute,
  );
}
