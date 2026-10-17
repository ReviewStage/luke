import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type SettingSideEffectId,
} from "@luke/settings";
import type { AppSettings, SettingsUpdateResult } from "@luke/settings/wire";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Effect, Option } from "effect";
import { ACT, ACT_KIND, type SettingUpdatePayload } from "../acts.js";
import type { HostOperator } from "../host-operator.js";
import { ActRefused, type ActRows } from "./router.js";

/** What one client-side effect is handed: the snapshot, and whether to wait. */
interface ClientSettingSideEffectContext {
  readonly settings: AppSettings;
  /**
   * Whether an effect that may be deferred must be waited on. A reset applies
   * every field in its scope and must not answer before the keys are back.
   */
  readonly waitForDeferredEffects: boolean;
}

type ClientSettingSideEffect = (context: ClientSettingSideEffectContext) => Promise<void> | void;

/**
 * Every side effect a setting can have, over the whole of the id set, as the
 * client applies it. Total on purpose: a new effect does not build until this
 * table and the host's both say what it does, where the `switch` this replaces
 * ended in a `default` that silently did nothing.
 */
export type ClientSettingSideEffects = Readonly<
  Record<SettingSideEffectId, ClientSettingSideEffect>
>;

/**
 * The settings rows as a client answers them: each write is validated here
 * against what the client alone holds — the chord reservations its keys hold —
 * carried to the host, which stores it, applies its own side effects, counts
 * it, and tells every other window; and then applied through the client's own
 * side effects, the ones only it has hands on (the desktop's login item, keys,
 * and duck).
 */
export interface SettingsActsDependencies<Sender> {
  host: Pick<
    HostOperator,
    "settingsSnapshot" | "updateSetting" | "resetSettings" | "setExperiment"
  >;
  /** The opaque token naming the window that asked, so the host's change event is not echoed back to it. */
  reporterOf: (sender: Sender) => string;
  /** The settings snapshot as this client last saw it, for the refusals worded here. */
  lastSettings: () => AppSettings | undefined;
  /** The client's own side effects, applied after the host's. */
  sideEffects: ClientSettingSideEffects;
  /** Which key already holds a chord the stop key would claim, named the way the row draws it; undefined where it is free. */
  stopChordHolder: (chord: string) => string | undefined;
}

/** Which kinds this file answers for: the settings writes. */
export type SettingsActKind =
  | typeof ACT_KIND.SETTING_UPDATE
  | typeof ACT_KIND.SETTINGS_RESET
  | typeof ACT_KIND.EXPERIMENT_SET;

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
  dependencies: Pick<SettingsActsDependencies<unknown>, "host" | "lastSettings">,
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
        // client could not carry leaves the row's switch describing
        // something that did not happen, so the row is answered a refusal it
        // can redraw from rather than a write that only half landed.
        Effect.tap((saved) => (apply === undefined ? Effect.void : apply(saved))),
        Effect.catch(() => refuse(ACT[kind].refusal)),
        Effect.catchDefect(() => refuse(ACT[kind].refusal)),
      );
    },
  };
}

export function settingsActRows<Sender>(
  dependencies: SettingsActsDependencies<Sender>,
): Pick<ActRows<Sender>, SettingsActKind> {
  const { host, reporterOf, sideEffects, stopChordHolder } = dependencies;
  const { write, refuse } = settingsWriter(dependencies);

  /** The side effects the client has hands on; the host applied its own before answering. A row of the table answers a value or a promise, settled by one door. */
  function applyClientSettingSideEffect(
    field: AppSettingField,
    settings: AppSettings,
    waitForDeferredEffects = false,
  ): Effect.Effect<void, unknown> {
    return Effect.tryPromise({
      try: () =>
        Promise.resolve(
          sideEffects[APP_SETTING_SCHEMA[field].sideEffect]({
            settings,
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
    return stopChordHolder(payload.value);
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
            : applyClientSettingSideEffect(payload.field, result.settings),
      );
    },
    // An experiment's switch has no side effect of the client's: the gated surfaces read it off the document.
    [ACT_KIND.EXPERIMENT_SET]: ({ experiment, on }, { sender }) =>
      write(ACT_KIND.EXPERIMENT_SET, host.setExperiment(experiment, on, reporterOf(sender))),
    [ACT_KIND.SETTINGS_RESET]: ({ scope }, { sender }) =>
      write(ACT_KIND.SETTINGS_RESET, host.resetSettings(scope, reporterOf(sender)), (result) =>
        result.reason
          ? Effect.void
          : Effect.forEach(
              APP_SETTING_FIELDS.filter((field) => {
                const definition = APP_SETTING_SCHEMA[field];
                return "resetScope" in definition && definition.resetScope === scope;
              }),
              (field) => applyClientSettingSideEffect(field, result.settings, true),
              { discard: true },
            ),
      ),
  };
}
