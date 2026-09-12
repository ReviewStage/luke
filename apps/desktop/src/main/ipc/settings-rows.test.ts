import assert from "node:assert/strict";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { settingsView } from "@sidecar/settings/testing";
import type { AppSettings, SettingsUpdateResult } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { test } from "vitest";
import { ACT, ACT_KIND } from "#shared/messages/acts";
import { appSettingsWire } from "../../testing/spoken-setting-bridge";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import type { HostOperator } from "../gateway/host-operator";
import type { MediaDuckController } from "../native/media-duck";
import type { DockPresence } from "../window/dock-presence";
import type { HotkeyRegistrar } from "../window/hotkey-registrar";
import type { PanelManager } from "../window/panel-manager";
import { settingsActRows } from "./settings-rows";

/**
 * What a settings row answers when the write, or the side effect only this
 * process can carry, does not land. The row's answer is what redraws the
 * switch, so a refusal has to arrive carrying the settings the store actually
 * holds — a bare refusal leaves the switch describing something that never
 * happened, and the host's change event skips the window that asked.
 */

const SETTINGS: AppSettings = appSettingsWire(settingsView());

// SAFETY: the rows read the sender only to name a reporter and a display; one inert object is one window.
const PANEL: ActSender = {
  sender: {} as WebContents,
  panel: true,
  voice: false,
  introduction: false,
};

function rows(overrides: {
  updateSetting?: () => Promise<SettingsUpdateResult>;
  connectGoogleCalendar?: () => Promise<SettingsUpdateResult>;
  applyLoginItem?: () => void;
  lastSettings?: () => AppSettings | undefined;
}) {
  const fragment = settingsActRows({
    // SAFETY: these rows reach only the three host calls named here.
    host: {
      updateSetting: overrides.updateSetting ?? (async () => accepted()),
      connectGoogleCalendar: overrides.connectGoogleCalendar ?? (async () => accepted()),
      settingsSnapshot: async () => undefined,
    } as unknown as HostOperator,
    reporterOf: () => "reporter",
    lastSettings: overrides.lastSettings ?? (() => SETTINGS),
    // SAFETY: the only key this row reads is the chord reservation, which the
    // field under test never asks for.
    hotkeys: { reserve: () => undefined } as unknown as HotkeyRegistrar,
    // SAFETY: `openAtLogin`'s side effect is the login item alone, so no row
    // under test reaches the Dock, the panels, or the duck.
    dock: {} as DockPresence,
    applyLoginItem: overrides.applyLoginItem ?? (() => undefined),
    // SAFETY: as above, the panels.
    panels: {} as PanelManager,
    // SAFETY: as above, the duck.
    mediaDuck: {} as MediaDuckController,
    openExternal: () => undefined,
  });
  // SAFETY: only the settings rows are under test; the router dispatches on the
  // kind alone, so the kinds this fragment does not answer are never reached.
  return createActRouter(fragment as ActRows);
}

function accepted(): SettingsUpdateResult {
  return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: SETTINGS };
}

const OPEN_AT_LOGIN = {
  kind: ACT_KIND.SETTING_UPDATE,
  payload: { field: APP_SETTING_SCHEMA.openAtLogin.field, value: true },
} as const;

test("a write the host took, whose client-side effect then failed, is refused with the settings", async () => {
  const router = rows({
    applyLoginItem: () => {
      throw new Error("the login item could not be written");
    },
  });
  assert.deepEqual(await Effect.runPromise(router.performAct(OPEN_AT_LOGIN, PANEL)), {
    status: "done",
    value: {
      status: ACTION_RESULT_STATUS.REJECTED,
      settings: SETTINGS,
      reason: ACT[ACT_KIND.SETTING_UPDATE].refusal,
    },
  });
});

test("a write the host refused is refused with the settings this client last saw", async () => {
  const router = rows({
    updateSetting: async () => {
      throw new Error("the host is not reachable");
    },
  });
  assert.deepEqual(await Effect.runPromise(router.performAct(OPEN_AT_LOGIN, PANEL)), {
    status: "done",
    value: {
      status: ACTION_RESULT_STATUS.REJECTED,
      settings: SETTINGS,
      reason: ACT[ACT_KIND.SETTING_UPDATE].refusal,
    },
  });
});

test("a client with no snapshot at all refuses through the act's own sentence", async () => {
  const router = rows({
    lastSettings: () => undefined,
    connectGoogleCalendar: async () => {
      throw new Error("the host is not reachable");
    },
  });
  assert.deepEqual(
    await Effect.runPromise(router.performAct({ kind: ACT_KIND.CALENDAR_CONNECT_GOOGLE }, PANEL)),
    {
      status: "refused",
      reason: ACT[ACT_KIND.CALENDAR_CONNECT_GOOGLE].refusal,
    },
  );
});

test("a write that landed is answered as the host answered it", async () => {
  const router = rows({});
  assert.deepEqual(await Effect.runPromise(router.performAct(OPEN_AT_LOGIN, PANEL)), {
    status: "done",
    value: accepted(),
  });
});
