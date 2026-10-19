/**
 * app-state.ts -- what a test of a surface gated by an experiment or a platform capability, or one that names the signed-in account or draws a call, stands on: main's document as the bridge hands it, with the account's experiments, the platform's capabilities, its identity, and its call as given.
 */

import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { SETTINGS_ACT_KIND } from "@luke/host/contract";
import { type ExperimentChoices, HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import type { AppSettingsView } from "@luke/settings/wire";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { AVATAR_OFF } from "@luke/voice/avatar";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { fakeActPort, fakeActPortCalls, fakeAppBridge, fakeAppBridgeCalls } from "./app-bridge.js";

/** What the desktop offers: every capability there is. */
export const DESKTOP_CAPABILITIES: readonly HostCapability[] = Object.values(HOST_CAPABILITY);

/** Main's document for a signed-in account in a panel on the desktop, idle, its experiments as given. */
function snapshotWith(experiments: ExperimentChoices): AppStateSnapshot {
  return {
    version: 1,
    run: {
      profile: "test",
      packaged: false,
      platform: "darwin",
      capabilities: DESKTOP_CAPABILITIES,
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
    network: { online: true },
    window: { fullScreen: false },
  };
}

/** Main's document with the account's experiments as given and the slices patched: a call standing, its avatar, the window's facts. */
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
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(snapshot),
  });
}

/** Hands the window main's document on a platform offering `capabilities`, no experiment on, beside whatever else the bridge already holds. */
export function handCapabilities(capabilities: readonly HostCapability[]): void {
  const snapshot = snapshotWith({});
  handState({}, { run: { ...snapshot.run, capabilities } });
}

/**
 * Hands the window main's document with its settings as given, and answers
 * each settings write as main does: stored, then the document delivered
 * again to every listener, so a surface draws the setting it wrote and the
 * next surface drawn reads it. Every other act and procedure is answered
 * as the window's fakes answered it before. The write is answered as
 * accepted.
 */
export function handSettings(settings: Partial<AppSettingsView> = {}): void {
  let view: AppSettingsView = Object.assign(settingsView(), settings);
  const listeners = new Set<(snapshot: AppStateSnapshot) => void>();
  const snapshot = () => stateWith({}, { settings: appSettingsWire(view) });
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: () => Promise.resolve(snapshot()),
    onAppState: (listener: (snapshot: AppStateSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  fakeActPort({
    ...fakeActPortCalls(),
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: (payload) => {
      view = Object.assign({ ...view }, { [payload.field]: payload.value });
      const next = snapshot();
      for (const listener of listeners) listener(next);
      return Promise.resolve({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        settings: appSettingsWire(view),
      });
    },
  });
}
