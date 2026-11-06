import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type SettingSideEffectId,
} from "@repo/settings";
import type { AppSettings, SettingsUpdateResult } from "@repo/settings/wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import type { ORPCError } from "@orpc/server";
import { Effect, Option } from "effect";
import { SETTINGS_ACT_KIND } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { type ActSender, actPort } from "./base.js";

interface ClientSettingSideEffectContext {
  readonly settings: AppSettings;
}

type ClientSettingSideEffect = (context: ClientSettingSideEffectContext) => Promise<void> | void;

export type ClientSettingSideEffects = Readonly<
  Record<SettingSideEffectId, ClientSettingSideEffect>
>;

export interface SettingsProceduresDependencies {
  host: Pick<
    HostOperator,
    "settingsSnapshot" | "updateSetting" | "resetSettings" | "setExperiment"
  >;
  reporterOf: (actor: ActSender) => string | undefined;
  lastSettings: () => AppSettings | undefined;
  sideEffects: ClientSettingSideEffects;
}

type Refused = (options?: { message?: string }) => ORPCError<string, unknown>;

export function settingsProcedures(dependencies: SettingsProceduresDependencies) {
  const { host, reporterOf, lastSettings, sideEffects } = dependencies;

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

  const write = (
    refused: Refused,
    save: Effect.Effect<SettingsUpdateResult>,
    apply?: (result: SettingsUpdateResult) => Effect.Effect<void, unknown>,
  ): Effect.Effect<SettingsUpdateResult, ORPCError<string, unknown>> =>
    save.pipe(
      Effect.tap((saved) => (apply === undefined ? Effect.void : apply(saved))),
      Effect.catch(() => refuse(refused().message, refused)),
      Effect.catchDefect(() => refuse(refused().message, refused)),
    );

  const reporterFor = (
    actor: ActSender,
    refused: Refused,
  ): Effect.Effect<string, ORPCError<string, unknown>> => {
    const reporter = reporterOf(actor);
    return reporter === undefined ? Effect.fail(refused()) : Effect.succeed(reporter);
  };

  function applyClientSettingSideEffect(
    field: AppSettingField,
    settings: AppSettings,
  ): Effect.Effect<void, unknown> {
    return Effect.tryPromise({
      try: () => Promise.resolve(sideEffects[APP_SETTING_SCHEMA[field].sideEffect]({ settings })),
      catch: (error) => error,
    });
  }

  return {
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: actPort[SETTINGS_ACT_KIND.SETTING_UPDATE].effect(
      function* ({ input, context, errors }) {
        const reporter = yield* reporterFor(context.actor, errors.REFUSED);
        return yield* write(
          errors.REFUSED,
          host.updateSetting(input.field, input.value as never, reporter),
          (result) =>
            result.reason
              ? Effect.void
              : applyClientSettingSideEffect(input.field, result.settings),
        );
      },
    ),
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
        return yield* write(
          errors.REFUSED,
          host.resetSettings(input.scope, input.kept, reporter),
          (result) =>
            result.reason
              ? Effect.void
              : Effect.forEach(
                  APP_SETTING_FIELDS.filter((field) => {
                    const definition = APP_SETTING_SCHEMA[field];
                    return (
                      "resetScope" in definition &&
                      definition.resetScope === input.scope &&
                      !input.kept.includes(field)
                    );
                  }),
                  (field) => applyClientSettingSideEffect(field, result.settings),
                  { discard: true },
                ),
        );
      },
    ),
  };
}
