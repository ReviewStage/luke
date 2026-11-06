import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  EXPERIMENT,
  SETTINGS_RESET_SCOPE,
} from "@repo/settings";
import { settingsUpdateResultSchema } from "@repo/settings/wire";
import { WireValueSchema } from "@repo/wire";
import { Effect, Schema as EffectSchema, SchemaGetter, SchemaIssue } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { SETTINGS_ACT_KIND } from "./kinds.js";

export type SettingUpdatePayload = {
  [Field in AppSettingField]: {
    field: Field;
    value: AppSettingValue<Field>;
  };
}[AppSettingField];

const carried = <A>(): EffectSchema.Codec<A, A> =>
  EffectSchema.declare((_value): _value is A => true);

const settingUpdatePayloadSchema = EffectSchema.Struct({
  field: EffectSchema.Literals(APP_SETTING_FIELDS),
  value: EffectSchema.optional(WireValueSchema),
}).pipe(
  EffectSchema.decodeTo(carried<SettingUpdatePayload>(), {
    decode: SchemaGetter.transformEffect((payload) => {
      const parsed = APP_SETTING_SCHEMA[payload.field].guard(payload.value);
      return parsed.valid
        ? Effect.succeed({ field: payload.field, value: parsed.value } as SettingUpdatePayload)
        : Effect.fail(new SchemaIssue.InvalidValue(undefined, payload));
    }),
    encode: SchemaGetter.transformEffect((payload: SettingUpdatePayload) =>
      Effect.succeed(payload),
    ),
  }),
);

export const settingsActsContract = {
  [SETTINGS_ACT_KIND.SETTING_UPDATE]: actProcedure("Could not save that setting on this system.")
    .input(exactInput(settingUpdatePayloadSchema))
    .output(EffectSchema.flip(settingsUpdateResultSchema)),
  [SETTINGS_ACT_KIND.SETTINGS_RESET]: actProcedure("Could not reset those settings on this system.")
    .input(
      exactInput(
        EffectSchema.Struct({
          scope: EffectSchema.Literals(Object.values(SETTINGS_RESET_SCOPE)),
          kept: EffectSchema.Array(EffectSchema.Literals(APP_SETTING_FIELDS)),
        }),
      ),
    )
    .output(EffectSchema.flip(settingsUpdateResultSchema)),
  [SETTINGS_ACT_KIND.EXPERIMENT_SET]: actProcedure(
    "Could not change that experiment on this system.",
  )
    .input(
      exactInput(
        EffectSchema.Struct({
          experiment: EffectSchema.Literals(Object.values(EXPERIMENT)),
          on: EffectSchema.Boolean,
        }),
      ),
    )
    .output(EffectSchema.flip(settingsUpdateResultSchema)),
};
