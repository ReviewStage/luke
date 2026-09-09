import { PRODUCT_EVENT } from "@sidecar/analytics";
import {
  CREDENTIAL_PROVIDER_ID,
  LinearCredentials,
  LinearIssueTracker,
  linearSignIn,
} from "@sidecar/credentials";
import { carried, GATEWAY_METHOD, type GatewayMethodTable, gatewayOk } from "@sidecar/gateway";
import { ObservationLoop } from "@sidecar/runtime";
import { ISSUE_TRACKER_ID, normalizeTrackedIssue, type TrackedIssue } from "@sidecar/session";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { reporterOf } from "./wire-helpers.js";

/** A board changes at the pace of hands, not of models; a minute is current. */
const ISSUE_REFRESH_INTERVAL_MS = 60_000;

export interface IssuesComposer extends Composer {
  /** The loop the merge's supervisor enables; the composer never enables it itself. */
  readonly loop: ObservationLoop;
  readonly trackers: readonly LinearIssueTracker[];
  issues: () => readonly TrackedIssue[] | undefined;
  refresh: () => void;
  /** What the account's capability gate takes back: the board a signed-out Luke may not draw. */
  stopObservation: () => void;
}

export interface IssuesDependencies {
  kernel: HostKernel;
  settings: SettingsComposer;
  observationGate: () => boolean;
}

export function composeIssues(dependencies: IssuesDependencies): IssuesComposer {
  const { kernel, settings, observationGate } = dependencies;
  const { report } = kernel;
  const settingsStore = settings.store;

  const linearCredentials = new LinearCredentials({
    readGrant: () => settingsStore.readGrant(CREDENTIAL_PROVIDER_ID.LINEAR),
    writeGrant: async (grant) => {
      await settingsStore.setGrant(CREDENTIAL_PROVIDER_ID.LINEAR, grant);
    },
    forgetGrant: async () => {
      const cleared = await settingsStore.clearGrant(CREDENTIAL_PROVIDER_ID.LINEAR);
      // Nobody pressed anything to end this connection — Linear refused the
      // renewal — so no settings reply is on its way to say so.
      settings.emitSettingsSnapshot(cleared.settings);
    },
  });
  const linearTracker = new LinearIssueTracker({
    readAccessToken: () => linearCredentials.accessToken(),
  });
  const linearConsent = linearSignIn({
    openExternal: (url) => void kernel.openExternalThroughNode(url).catch(kernel.reportOpenFailure),
  });
  const issueTrackers = [linearTracker] as const;
  let trackedIssues: readonly TrackedIssue[] | undefined;

  async function refreshTrackedIssues(generation: number): Promise<void> {
    try {
      const collected: TrackedIssue[] = [];
      let connected = false;
      for (const tracker of issueTrackers) {
        const observations = await tracker.observe();
        if (!observations) continue;
        connected = true;
        for (const observation of observations) {
          const issue = normalizeTrackedIssue(tracker.tracker, observation);
          if (issue) collected.push(issue);
        }
      }
      if (loop.isCurrent(generation)) {
        trackedIssues = connected ? collected : undefined;
      }
    } catch (error) {
      report(`Issue observation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function stopObservation(): void {
    trackedIssues = undefined;
  }

  const loop = new ObservationLoop({
    gate: observationGate,
    intervalMs: ISSUE_REFRESH_INTERVAL_MS,
    run: refreshTrackedIssues,
  });

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.TRACKER_CONNECT]: async (params) => {
      const result = await settings.settingsWrite(
        async () => {
          const outcome = await linearConsent.signIn();
          if ("reason" in outcome) return settings.refusedSettings(outcome.reason);
          return settingsStore.setGrant(CREDENTIAL_PROVIDER_ID.LINEAR, outcome);
        },
        (saved) => {
          if (saved.reason) return;
          void loop.refresh();
          settings.recordProductEvent(PRODUCT_EVENT.TRACKER_CONNECT, {
            tracker_id: ISSUE_TRACKER_ID.LINEAR,
          });
        },
        "Could not connect Linear on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.TRACKER_CANCEL_SIGN_IN]: () => {
      linearConsent.cancel();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.TRACKER_REOPEN_SIGN_IN]: () => {
      linearConsent.reopen();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.TRACKER_DISCONNECT]: async (params) => {
      const result = await settings.settingsWrite(
        async () => {
          await linearCredentials.disconnect();
          return { status: ACT_RESULT_STATUS.ACCEPTED, settings: await settingsStore.snapshot() };
        },
        (saved) => {
          if (saved.reason) return;
          void loop.refresh();
          settings.recordProductEvent(PRODUCT_EVENT.TRACKER_DISCONNECT, {
            tracker_id: ISSUE_TRACKER_ID.LINEAR,
          });
        },
        "Could not disconnect Linear on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
  };

  return {
    methods,
    loop,
    trackers: issueTrackers,
    issues: () => trackedIssues,
    refresh: () => void loop.refresh(),
    stopObservation,
    // The loop is armed by the merge's supervisor, so there is nothing of its own to begin.
    start: async () => undefined,
    stop: async () => {
      stopObservation();
    },
  };
}
