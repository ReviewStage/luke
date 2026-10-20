import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type SettingSideEffectId,
} from "@luke/settings";
import type { AppSettings, SettingsUpdateResult } from "@luke/settings/wire";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import type { ORPCError } from "@orpc/server";
import { Effect, Option } from "effect";
import { SETTINGS_ACT_KIND, type SettingUpdatePayload } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { type ActSender, actPort } from "./base.js";

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
 * settings-procedures.ts -- the settings writes as a client answers them.
 *
 * Each write is validated here against what the client alone holds — the
 * chord reservations its keys hold — carried to the host, which stores it,
 * applies its own side effects, counts it, and tells every other window; and
 * then applied through the client's own side effects, the ones only it has
 * hands on (the desktop's login item, keys, and duck).
 */
export interface SettingsProceduresDependencies {
  host: Pick<
    HostOperator,
    "settingsSnapshot" | "updateSetting" | "resetSettings" | "setExperiment"
  >;
  /**
   * The opaque token naming the window that asked, so the host's change
   * event is not echoed back to it; undefined for a sender the platform does
   * not hold as a window of its own, which is refused in the act's own words.
   */
  reporterOf: (actor: ActSender) => string | undefined;
  /** The settings snapshot as this client last saw it, for the refusals worded here. */
  lastSettings: () => AppSettings | undefined;
  /** The client's own side effects, applied after the host's. */
  sideEffects: ClientSettingSideEffects;
  /** Which key already holds a chord the stop key would claim, named the way the row draws it; undefined where it is free. */
  stopChordHolder: (chord: string) => string | undefined;
}

/** A procedure's own refusal, worded as given, or in its own sentence where none is. */
type Refused = (options?: { message?: string }) => ORPCError<string, unknown>;

export function settingsProcedures(dependencies: SettingsProceduresDependencies) {
  const { host, reporterOf, lastSettings, sideEffects, stopChordHolder } = dependencies;

  /**
   * A refusal decided here rather than by the host: the settings as they
   * stand, and why, which the row redraws from; refused outright, in the
   * same words, where this client holds no settings at all.
   */
  const refuse = (
    reason: string,
    refused: Refused,
  ): Effect.Effect<SettingsUpdateResult, ORPCError<string, unknown>> =>
    Effect.suspend(() => {
      const held = lastSettings();
      return held ? Effect.succeedSome(held) : host.settingsSnapshot();
    }).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(refused({ message: reason })),
          onSome: (settings) =>
            Effect.succeed<SettingsUpdateResult>({
              status: ACTION_RESULT_STATUS.REJECTED,
              settings,
              reason,
            }),
        }),
      ),
    );

  /**
   * One settings write. The host's change event is what every other window
   * hears; the window that asked hears this answer and is skipped there. A
   * write or an apply that died is refused over the settings this client last
   * saw, worded by the procedure's own sentence.
   */
  const write = (
    refused: Refused,
    save: Effect.Effect<SettingsUpdateResult>,
    apply?: (result: SettingsUpdateResult) => Effect.Effect<void, unknown>,
  ): Effect.Effect<SettingsUpdateResult, ORPCError<string, unknown>> =>
    save.pipe(
      // The apply is inside the same reach as the write: a side effect this
      // client could not carry leaves the row's switch describing
      // something that did not happen, so the row is answered a refusal it
      // can redraw from rather than a write that only half landed.
      Effect.tap((saved) => (apply === undefined ? Effect.void : apply(saved))),
      Effect.catch(() => refuse(refused().message, refused)),
      Effect.catchDefect(() => refuse(refused().message, refused)),
    );

  /** The reporter naming the window that asked, or the procedure's own refusal for a sender that is no window of this platform's. */
  const reporterFor = (
    actor: ActSender,
    refused: Refused,
  ): Effect.Effect<string, ORPCError<string, unknown>> => {
    const reporter = reporterOf(actor);
    return reporter === undefined ? Effect.fail(refused()) : Effect.succeed(reporter);
  };

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
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: actPort[SETTINGS_ACT_KIND.SETTING_UPDATE].effect(
      function* ({ input, context, errors }) {
        const reporter = yield* reporterFor(context.actor, errors.REFUSED);
        const holder = chordHolder(input);
        if (holder)
          return yield* refuse(`That chord is reserved for the ${holder} key.`, errors.REFUSED);
        return yield* write(
          errors.REFUSED,
          // SAFETY: the procedure's own input schema parsed this value for this field.
          host.updateSetting(input.field, input.value as never, reporter),
          (result) =>
            result.reason
              ? Effect.void
              : applyClientSettingSideEffect(input.field, result.settings),
        );
      },
    ),
    // An experiment's switch has no side effect of the client's: the gated surfaces read it off the document.
    [SETTINGS_ACT_KIND.EXPERIMENT_SET]: actPort[SETTINGS_ACT_KIND.EXPERIMENT_SET].effect(
      function* ({ input, context, errors }) {
        const reporter = yield* reporterFor(context.actor, errors.REFUSED);
        return yield* write(
          errors.REFUSED,
          host.setExperiment(input.experiment, input.on, reporter),
        );
      },
    ),
    [SETTINGS_ACT_KIND.SETTINGS_RESET]: actPort[SETTINGS_ACT_KIND.SETTINGS_RESET].effect(
      function* ({ input, context, errors }) {
        const reporter = yield* reporterFor(context.actor, errors.REFUSED);
        return yield* write(errors.REFUSED, host.resetSettings(input.scope, reporter), (result) =>
          result.reason
            ? Effect.void
            : Effect.forEach(
                APP_SETTING_FIELDS.filter((field) => {
                  const definition = APP_SETTING_SCHEMA[field];
                  return "resetScope" in definition && definition.resetScope === input.scope;
                }),
                (field) => applyClientSettingSideEffect(field, result.settings, true),
                { discard: true },
              ),
        );
      },
    ),
  };
}
