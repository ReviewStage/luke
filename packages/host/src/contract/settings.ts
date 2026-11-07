import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  EXPERIMENT,
  SETTINGS_RESET_SCOPE,
} from "@repo/settings";
import { settingsUpdateResultSchema } from "@repo/settings/wire";
import { ACT } from "@repo/sync";
import { WireValueSchema } from "@repo/wire";
import { Effect, Schema as EffectSchema, SchemaGetter, SchemaIssue } from "effect";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";

/**
 * settings.ts -- the settings writes a window asks of the host, declared.
 *
 * Each answers the settings as they then stand.
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

/** The settings writes, each answered by the settings' composer and by hand at the port (`act-port/settings-procedures.ts`), which names the asking window and applies the client's own side effects. */
export const SETTINGS_ACTS = declaredActs({
  SETTING_UPDATE: hostAct({
    input: settingUpdatePayloadSchema,
    output: settingsUpdateResultSchema,
    refusal: "Could not save that setting on this system.",
    panelOnly: false,
    door: ACT.LOCAL_WRITE,
    byHand: true,
  }),
  SETTINGS_RESET: hostAct({
    input: EffectSchema.Struct({
      scope: EffectSchema.Literals(Object.values(SETTINGS_RESET_SCOPE)),
      /** The group's fields the asking page does not draw, which the reset leaves as they stand. */
      kept: EffectSchema.Array(EffectSchema.Literals(APP_SETTING_FIELDS)),
    }),
    output: settingsUpdateResultSchema,
    refusal: "Could not reset those settings on this system.",
    panelOnly: false,
    door: ACT.LOCAL_WRITE,
    byHand: true,
  }),
  EXPERIMENT_SET: hostAct({
    input: EffectSchema.Struct({
      experiment: EffectSchema.Literals(Object.values(EXPERIMENT)),
      on: EffectSchema.Boolean,
    }),
    output: settingsUpdateResultSchema,
    refusal: "Could not change that experiment on this system.",
    panelOnly: false,
    door: ACT.REMOTE_WORK,
    byHand: true,
  }),
});

export const settingsActsContract = contractOf(SETTINGS_ACTS);
