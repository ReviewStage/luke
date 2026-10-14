/**
 * app-state.ts -- what a test of a surface gated by an experiment, or one that names the signed-in account or draws a call, stands on: main's document as the bridge hands it, with the account's experiments, its identity, and its call as given.
 */

import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WINDOW_ROLE } from "@luke/gateway/window-session";
import type { AppStateSnapshot } from "@luke/host/app-state";
import type { ExperimentChoices } from "@luke/settings";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { AVATAR_OFF } from "@luke/voice/avatar";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";

/** Main's document for a signed-in account in a panel, idle, its experiments as given. */
function snapshotWith(experiments: ExperimentChoices): AppStateSnapshot {
  return {
    version: 1,
    run: {
      profile: "test",
      packaged: false,
      platform: "darwin",
      appVersion: "1.0.0",
      captureMode: false,
      fixtureMode: false,
      accountRequired: false,
      agentTraceEnabled: false,
    },
    settings: appSettingsWire(settingsView({ experiments })),
    account: {
      status: ACCOUNT_STATUS.SIGNED_IN,
      email: "dev@example.com",
      name: "Dev",
      provider: "github",
    },
    update: {
      status: UPDATE_STATUS.IDLE,
      currentVersion: "1.0.0",
      installSupported: true,
      upToDate: false,
    },
    audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED },
    hotkeys: { talkHeld: true },
    voice: { avatar: AVATAR_OFF },
    tasks: IDLE_TASKS_VIEW,
    codingAgents: { unseen: [] },
    inbox: { waiting: [], tasks: [], taskless: [], automations: [], failedRuns: [] },
    notifications: { status: NOTIFICATIONS_STATUS.UNKNOWN },
    sessionReplay: { permitted: false, halted: false },
    window: { role: WINDOW_ROLE.PANEL, fullScreen: false },
  };
}

/** Main's document with the account's experiments as given and the slices patched: a call standing, its avatar, the window's role. */
export function stateWith(
  experiments: ExperimentChoices,
  patch: Partial<AppStateSnapshot>,
): AppStateSnapshot {
  return { ...snapshotWith(experiments), ...patch };
}

/** Main's document for the account signed in as given, no experiment on. */
export function signedInAs(account: {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}): AppStateSnapshot {
  const snapshot = snapshotWith({});
  return { ...snapshot, account: { ...snapshot.account, ...account } };
}

/** Hands the window main's document with the account's experiments as given and the slices patched, beside whatever else the bridge already holds. */
export function handState(
  experiments: ExperimentChoices,
  patch: Partial<AppStateSnapshot> = {},
): void {
  const snapshot = stateWith(experiments, patch);
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      ...window.luke,
      onAppState: () => () => undefined,
      requestAppState: () => Promise.resolve(snapshot),
    },
  });
}
