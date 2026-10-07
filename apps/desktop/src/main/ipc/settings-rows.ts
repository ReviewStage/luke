import { APP_SETTING_FIELDS, APP_SETTING_SCHEMA, type AppSettingField } from "@sidecar/settings";
import type { AppSettings, SettingsUpdateResult } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Effect, Option } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, type SettingUpdatePayload } from "#shared/messages/acts";
import { ActRefused, type ActRows } from "../act-router";
import type { HostOperator } from "../gateway/host-operator";
import type { MediaDuckController } from "../native/media-duck";
import type { DockPresence } from "../window/dock-presence";
import { HOTKEY_RANK, type HotkeyRegistrar } from "../window/hotkey-registrar";
import type { PanelManager } from "../window/panel-manager";
import { clientSettingSideEffects } from "./settings-side-effects";

/**
 * The settings rows as the desktop client answers them: each write is
 * validated here where the client alone can — the chord reservations the keys
 * hold — carried to the host, which stores it, applies its own side effects,
 * counts it, and tells every other window; and then applied here for the side
 * effects only this process has hands on: the login item, the Dock, the
 * keys, the duck.
 */
export interface SettingsRowsDependencies {
  host: HostOperator;
  /** The opaque token naming the window that asked, so the host's change event is not echoed back to it. */
  reporterOf: (sender: WebContents) => string;
  /** The settings snapshot as this client last saw it, for the refusals worded here. */
  lastSettings: () => AppSettings | undefined;
  hotkeys: HotkeyRegistrar;
  dock: DockPresence;
  applyLoginItem: (openAtLogin: boolean) => void;
  panels: PanelManager;
  mediaDuck: MediaDuckController;
}

/** Which kinds this file answers for: the settings writes. */
type SettingsActKind = typeof ACT_KIND.SETTING_UPDATE | typeof ACT_KIND.SETTINGS_RESET;

/** How every settings row below answers: a write carried, or a refusal the row can draw. */
interface SettingsWriter {
  /**
   * One settings write. The host's change event is what every other window
   * hears; the window that asked hears this answer and is skipped there. A
   * write or an apply that died is refused over the settings this client last
   * saw, worded by the act's own sentence.
   */
  write(
    kind: SettingsActKind,
    save: Effect.Effect<SettingsUpdateResult>,
    apply?: (result: SettingsUpdateResult) => Effect.Effect<void, unknown>,
  ): Effect.Effect<SettingsUpdateResult, ActRefused>;
  /** A refusal decided here rather than by the host: the settings as they stand, and why. */
  refuse(reason: string): Effect.Effect<SettingsUpdateResult, ActRefused>;
}

function settingsWriter(
  dependencies: Pick<SettingsRowsDependencies, "host" | "lastSettings">,
): SettingsWriter {
  const refuse = (reason: string): Effect.Effect<SettingsUpdateResult, ActRefused> =>
    Effect.suspend(() => {
      const held = dependencies.lastSettings();
      return held ? Effect.succeedSome(held) : dependencies.host.settingsSnapshot();
    }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new ActRefused({ message: reason })),
          onSome: (settings) =>
            Effect.succeed<SettingsUpdateResult>({
              status: ACTION_RESULT_STATUS.REJECTED,
              settings,
              reason,
            }),
        }),
      ),
    );
  return {
    refuse,
    write(kind, save, apply) {
      return save.pipe(
        // The apply is inside the same reach as the write: a side effect this
        // process could not carry leaves the row's switch describing
        // something that did not happen, so the row is answered a refusal it
        // can redraw from rather than a write that only half landed.
        Effect.tap((saved) => (apply === undefined ? Effect.void : apply(saved))),
        Effect.catch(() => refuse(ACT[kind].refusal)),
        Effect.catchDefect(() => refuse(ACT[kind].refusal)),
      );
    },
  };
}

export function settingsActRows(
  dependencies: SettingsRowsDependencies,
): Pick<ActRows, SettingsActKind> {
  const { host, reporterOf, hotkeys, dock, applyLoginItem, panels, mediaDuck } = dependencies;
  const { write, refuse } = settingsWriter(dependencies);

  const sideEffects = clientSettingSideEffects({
    hotkeys,
    dock,
    applyLoginItem,
    panels,
    mediaDuck,
  });

  /** The side effects this process has hands on; the host applied its own before answering. A row of the table answers a value or a promise, settled by one door. */
  function applyClientSettingSideEffect(
    field: AppSettingField,
    settings: AppSettings,
    sender: WebContents,
    waitForDeferredEffects = false,
  ): Effect.Effect<void, unknown> {
    return Effect.tryPromise({
      try: () =>
        Promise.resolve(
          sideEffects[APP_SETTING_SCHEMA[field].sideEffect]({
            settings,
            sender,
            waitForDeferredEffects,
          }),
        ),
      catch: (error) => error,
    });
  }

  /**
   * Which key a chord this write would claim is already spoken for, named the
   * way the row will draw it. Read from the payload rather than a field and a
   * value apart, because it is the field that says the value is a chord.
   */
  const chordHolder = (payload: SettingUpdatePayload): string | undefined => {
    if (payload.field !== APP_SETTING_SCHEMA.stopHotkey.field) return undefined;
    if (payload.value === undefined) return undefined;
    return hotkeys.reserve(payload.value, HOTKEY_RANK.STOP) === HOTKEY_RANK.TALK
      ? "talk"
      : undefined;
  };

  return {
    [ACT_KIND.SETTING_UPDATE]: (payload, { sender }) => {
      const holder = chordHolder(payload);
      if (holder) return refuse(`That chord is reserved for the ${holder} key.`);
      return write(
        ACT_KIND.SETTING_UPDATE,
        // SAFETY: the act's own schema parsed this value for this field.
        host.updateSetting(payload.field, payload.value as never, reporterOf(sender)),
        (result) =>
          result.reason
            ? Effect.void
            : applyClientSettingSideEffect(payload.field, result.settings, sender),
      );
    },
    [ACT_KIND.SETTINGS_RESET]: ({ scope }, { sender }) =>
      write(ACT_KIND.SETTINGS_RESET, host.resetSettings(scope, reporterOf(sender)), (result) =>
        result.reason
          ? Effect.void
          : Effect.forEach(
              APP_SETTING_FIELDS.filter((field) => {
                const definition = APP_SETTING_SCHEMA[field];
                return "resetScope" in definition && definition.resetScope === scope;
              }),
              (field) => applyClientSettingSideEffect(field, result.settings, sender, true),
              { discard: true },
            ),
      ),
  };
}
