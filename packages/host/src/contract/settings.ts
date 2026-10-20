import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  EXPERIMENT,
  SETTINGS_RESET_SCOPE,
} from "@luke/settings";
import { settingsUpdateResultSchema } from "@luke/settings/wire";
import { WireValueSchema } from "@luke/wire";
import { Effect, Schema as EffectSchema, SchemaGetter, SchemaIssue } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { SETTINGS_ACT_KIND } from "./kinds.js";

/**
 * settings.ts -- the settings writes a window asks of the host, as procedures.
 *
 * Each answers the settings as they then stand, its schema flipped, so oRPC's
 * output check encodes the row's value into what crosses the port, the
 * convention every act contract keeps (`agents.ts`).
 */

/** A setting and a value already parsed for it, which is the pair its field types. */
export type SettingUpdatePayload = {
  [Field in AppSettingField]: {
    field: Field;
    value: AppSettingValue<Field>;
  };
}[AppSettingField];

/** A payload this module has already read, carried on as it is. */
const carried = <A>(): EffectSchema.Codec<A, A> =>
  EffectSchema.declare((_value): _value is A => true);

/**
 * The one payload whose value is parsed by the field beside it. The parsed
 * value is what the payload carries, so the row receives the value its
 * field's own guard admitted rather than the one that arrived (a chord
 * normalized, say), and there is no second guard to disagree with this one.
 */
const settingUpdatePayloadSchema = EffectSchema.Struct({
  field: EffectSchema.Literals(APP_SETTING_FIELDS),
  value: EffectSchema.optional(WireValueSchema),
}).pipe(
  EffectSchema.decodeTo(carried<SettingUpdatePayload>(), {
    decode: SchemaGetter.transformEffect((payload) => {
      const parsed = APP_SETTING_SCHEMA[payload.field].guard(payload.value);
      return parsed.valid
        ? // SAFETY: the field's own guard admitted this value for this field.
          Effect.succeed({ field: payload.field, value: parsed.value } as SettingUpdatePayload)
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
          /** The group's fields the asking page does not draw, which the reset leaves as they stand. */
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
