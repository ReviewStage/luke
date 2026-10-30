/**
 * app-state.ts -- what a test of a surface gated by an experiment or a platform capability, or one that names the signed-in account or draws a call, stands on: main's document as the bridge hands it, with the account's experiments, the platform's capabilities, its identity, and its call as given.
 */

import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { LIVE_READ } from "@luke/features/live-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import {
  type AppHolderInboxes,
  type AppHostRead,
  type AppInboxItems,
  type AppStateDelivery,
  type AppStateSnapshot,
  NO_HOLDER_INBOXES,
  UNREAD,
} from "@luke/host/app-state";
import { SETTINGS_ACT_KIND } from "@luke/host/contract";
import { type ExperimentChoices, HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import { MICROPHONE_STATUS } from "@luke/settings/microphone";
import { NOTIFICATIONS_STATUS } from "@luke/settings/settings-controls";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import type { AppSettingsView } from "@luke/settings/wire";
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
    },
    settings: appSettingsWire(settingsView({ experiments })),
    account: {
      status: ACCOUNT_STATUS.SIGNED_IN,
      email: "dev@example.com",
      name: "Dev",
      provider: "github",
    },
    access: { admin: false },
    update: {
      status: UPDATE_STATUS.IDLE,
      currentVersion: "1.0.0",
      installSupported: true,
      upToDate: false,
    },
    audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED },
    tasks: IDLE_TASKS_VIEW,
    agents: { unseen: [] },
    inbox: { waiting: [], tasks: [], taskless: [], automations: [], agents: [], failedRuns: [] },
    [LIVE_READ.INBOX_ITEMS]: UNREAD,
    [LIVE_READ.HOLDER_INBOX]: NO_HOLDER_INBOXES,
    macCommands: { asks: [] },
    notifications: { status: NOTIFICATIONS_STATUS.UNKNOWN },
    sessionReplay: { permitted: false, halted: false },
    network: { online: true },
    window: { fullScreen: false },
  };
}

/** A document as main's push delivers it to a window that holds none of it yet: every entry. */
export function deliveryOf(snapshot: AppStateSnapshot): AppStateDelivery {
  const { version, ...entries } = snapshot;
  return { version, entries };
}

/** Main's document with the account's experiments as given and the slices patched, the window's facts among them. */
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
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  const snapshot = () => stateWith({}, { settings: appSettingsWire(view) });
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: () => Promise.resolve(snapshot()),
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  fakeActPort({
    ...fakeActPortCalls(),
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: (payload) => {
      view = Object.assign({ ...view }, { [payload.field]: payload.value });
      const next = deliveryOf(snapshot());
      for (const listener of listeners) listener(next);
      return Promise.resolve({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        settings: appSettingsWire(view),
      });
    },
  });
}

/** How the host's reads are delivered again as each moves, as the host tells them. */
export interface HostReadsHanded {
  readonly deliverItems: (next: AppHostRead<AppInboxItems>) => void;
  readonly deliverHolders: (next: AppHolderInboxes) => void;
}

/**
 * Lays the host's reads as given, the account's feed of every item and the
 * holders' own inboxes, over whatever document the window was handed, its
 * experiments and the reads handed before among it, and answers with how
 * each is delivered again as it moves, as the host tells it.
 */
export function handHostReads(first: {
  readonly items?: AppHostRead<AppInboxItems>;
  readonly holders?: AppHolderInboxes;
}): HostReadsHanded {
  const handed = fakeAppBridgeCalls().requestAppState;
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  let version = 1;
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: async () => ({
      ...(handed === undefined ? snapshotWith({}) : await handed()),
      version,
      ...(first.items === undefined ? undefined : { [LIVE_READ.INBOX_ITEMS]: first.items }),
      ...(first.holders === undefined ? undefined : { [LIVE_READ.HOLDER_INBOX]: first.holders }),
    }),
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const deliver = (entries: AppStateDelivery["entries"]) => {
    version += 1;
    for (const listener of [...listeners]) listener({ version, entries });
  };
  return {
    deliverItems: (next) => deliver({ [LIVE_READ.INBOX_ITEMS]: next }),
    deliverHolders: (next) => deliver({ [LIVE_READ.HOLDER_INBOX]: next }),
  };
}

/** Lays the account's feed of every item as given over the window's document, and answers with how it is delivered again as it moves. */
export function handInboxItems(
  first: AppHostRead<AppInboxItems>,
): (next: AppHostRead<AppInboxItems>) => void {
  return handHostReads({ items: first }).deliverItems;
}
