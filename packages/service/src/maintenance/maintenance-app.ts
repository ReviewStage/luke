import type { DatabaseServices } from "@repo/database/core/query";
import { sweepAbandonedTurns } from "@repo/database/models/abandoned-turns";
import { purgeUnsavedAttachments } from "@repo/database/models/description-attachments";
import { hostedStore } from "@repo/database/models/hosted-store";
import { dropStaleFirewalls } from "@repo/database/models/sandbox-firewall-store";
import { pruneSyncLog } from "@repo/database/models/sync-log";
import { storeWriter } from "@repo/database/models/writer";
import { Effect, Layer } from "effect";
import { HttpClient, HttpRouter } from "effect/http";
import { sweepAgentQueues } from "../agents/coder-host/agent-queue.js";
import { CODER } from "../agents/coder-host/bounds.js";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { sessionSandboxesLayer, sweepSessionSandboxes } from "../agents/session-sandboxes.js";
import type { SessionsForAccount } from "../automations/automation-runs.js";
import { sweepAutomations } from "../automations/automation-sweep.js";
import { HostedEnvironment } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { type CronMonitor, sentryCronCheckIns } from "../observability/sentry.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { sweepCodexPlanSwaps } from "./codex-plan-sweep.js";
import { sweepDeviceLeases } from "./device-lease-sweep.js";
import { sweepDeviceWarmRunners } from "./device-warm-sweep.js";
import { MAINTENANCE_SWEEP, MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";
import { handleMaintenanceSweep } from "./maintenance-sweep.js";
import { sweepNativeSandboxes } from "./native-sandbox-sweep.js";
import { sweepNativeWakeups } from "./native-wakeup-sweep.js";

/** The sweep as Sentry's Crons watches it: three minutes in a row missed, late, or failed open an issue. */
const SWEEP_MONITOR: CronMonitor = {
  slug: "maintenance-sweep",
  crontab: MAINTENANCE_SWEEP.CRONTAB,
  // Note that the check-in times the sweep's own work alone, never what it hands on past its answer, so a sweep still running when the next is called is late.
  maxRuntimeMinutes: 1,
  checkInMarginMinutes: 1,
  failuresBeforeIssue: 3,
};

/** How long a picture pasted into a description waits for a save to name it before the sweep deletes it: a day, so an edit left open over lunch keeps its pictures. */
const UNSAVED_PICTURE_GRACE_MS = 24 * 60 * 60 * 1_000;

/** How long a sandbox firewall's record outlives its last write before the sweep drops it: an hour past the longest a session runs, so its session has surely ended. */
const FIREWALL_RECORD_KEEP_MS = CODER.SANDBOX_MAX_LIFETIME_MS + 60 * 60 * 1_000;

/**
 * The scheduled sweep handed the deployment's real seams. An automation's run
 * reaches its agent's session through `routedSessions` acting for the
 * automation's owner, never the bearer the cron called with.
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
  const sessionsFor: SessionsForAccount = routedSessions;
  const httpClient = yield* HttpClient.HttpClient;
  const sandboxes = Layer.provide(
    sessionSandboxesLayer,
    Layer.succeed(HttpClient.HttpClient, httpClient),
  );
  return yield* handleMaintenanceSweep({
    request,
    cronSecret: environment.cronSecret,
    monitor: sentryCronCheckIns(SWEEP_MONITOR),
    purgeCleared: (now) => hostedStore().retention.purgeCleared(new Date(now)),
    sweepAbandonedTurns: (now) =>
      Effect.flatMap(storeWriter({ tools: CODER_TOOL_SET }), (writer) =>
        sweepAbandonedTurns({ writer }, { now }),
      ),
    sweepDeviceLeases: (now) =>
      Effect.flatMap(storeWriter({ tools: CODER_TOOL_SET }), (writer) =>
        sweepDeviceLeases(writer, { now }),
      ),
    sweepDeviceWarmRunners: (now) =>
      sweepDeviceWarmRunners(new Date(now)).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
      ),
    sweepSandboxes: (now) => sweepSessionSandboxes(new Date(now)).pipe(Effect.provide(sandboxes)),
    sweepNativeSandboxes: (now) =>
      sweepNativeSandboxes(new Date(now)).pipe(Effect.provideContext(startContext)),
    sweepNativeWakeups: (now) =>
      sweepNativeWakeups(sessionsFor, new Date(now)).pipe(Effect.provideContext(startContext)),
    sweepAgentQueues: () => sweepAgentQueues(sessionsFor).pipe(Effect.provideContext(startContext)),
    sweepAutomations: (now) =>
      sweepAutomations(sessionsFor, now).pipe(Effect.provideContext(startContext)),
    purgeUnsavedPictures: (now) =>
      purgeUnsavedAttachments(new Date(now - UNSAVED_PICTURE_GRACE_MS)),
    pruneSyncLog: (now) => pruneSyncLog(new Date(now)),
    purgeStaleFirewalls: (now) => dropStaleFirewalls(new Date(now - FIREWALL_RECORD_KEEP_MS)),
    renewCodexPlanSwaps: (now) =>
      sweepCodexPlanSwaps(environment.providerKeyEncryptionKeys, new Date(now)).pipe(
        Effect.provideContext(startContext),
        Effect.provideService(HostedEnvironment, environment),
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
