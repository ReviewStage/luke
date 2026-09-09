import type {
  AppSettingField,
  AppSettingValue,
  KeyedAppSettingField,
  SettingEntryValue,
} from "@sidecar/settings";
import type { SettingsUpdateResult } from "@sidecar/settings/wire";
import {
  ACT,
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type ActKind,
  type ActPayload,
  type ActResultFor,
  type SettingEntryPayload,
  type SettingUpdatePayload,
} from "#shared/messages/acts";

/** A kind that carries nothing is called with nothing; every other kind carries its own payload. */
type ActArguments<Kind extends ActKind> =
  ActPayload<Kind> extends undefined ? [] : [payload: ActPayload<Kind>];

/**
 * The one way this window causes anything: one kind and its payload, over
 * `app:act`, answered with that kind's own value. The main process refuses as
 * a value rather than a throw, and the refusal's sentence becomes this call's
 * rejection, which is how every row that reads a failure already reads one.
 * The answer is checked against the kind's own guard before a caller sees it,
 * so a main process out of step with this window is a rejection here rather
 * than a wrong value drawn.
 */
export async function act<Kind extends ActKind>(
  kind: Kind,
  ...[payload]: ActArguments<Kind>
): Promise<ActResultFor<Kind>> {
  const outcome = await window.sidecar.act(
    // SAFETY: ActArguments pairs this payload with its kind, which is the pairing Act declares.
    (payload === undefined ? { kind } : { kind, payload }) as Parameters<
      typeof window.sidecar.act
    >[0],
  );
  if (outcome.status === ACT_OUTCOME_STATUS.UNKNOWN_ACT) {
    throw new Error(`Luke does not know the act ${kind}.`);
  }
  if (outcome.status === ACT_OUTCOME_STATUS.REFUSED) throw new Error(outcome.reason);
  if (ACT[kind].result(outcome.value) === false) {
    throw new Error(`Invalid answer to the act ${kind}.`);
  }
  // SAFETY: the kind's own result guard admitted this value.
  return outcome.value as ActResultFor<Kind>;
}

/**
 * An act whose answer nothing reads, which is what a fire-and-forget send
 * was. The refusal is still a value at the channel; here it is dropped rather
 * than left to surface as an unhandled rejection in a window that had nowhere
 * to draw it. A kind whose refusal a row should show is called through
 * {@link act} instead.
 */
export function tell<Kind extends ActKind>(kind: Kind, ...args: ActArguments<Kind>): void {
  void act(kind, ...args).catch(() => undefined);
}

/**
 * The two settings writes, generic in the field each names, for the callers
 * that take them as a seam: the spoken settings change carries them, and a
 * test hands the same shape a fixture. Both are the acts a row's own press
 * mints — there is no second way to write a setting.
 */
export interface SettingWriteActs {
  updateSetting<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
  ): Promise<SettingsUpdateResult>;
  updateSettingEntry<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    value: SettingEntryValue<Field> | undefined,
  ): Promise<SettingsUpdateResult>;
}

export function updateSetting<Field extends AppSettingField>(
  field: Field,
  value: AppSettingValue<Field>,
): Promise<SettingsUpdateResult> {
  // SAFETY: the payload pairs a field with its own value type, which is the
  // pairing SettingUpdatePayload distributes over every plain field; a keyed
  // field is refused by the act's own schema, as the bridge guard refused it
  // before there were acts.
  return act(ACT_KIND.SETTING_UPDATE, { field, value } as SettingUpdatePayload);
}

export function updateSettingEntry<Field extends KeyedAppSettingField>(
  field: Field,
  key: string,
  value: SettingEntryValue<Field> | undefined,
): Promise<SettingsUpdateResult> {
  // SAFETY: as above, for the keyed fields and their entry values.
  return act(ACT_KIND.SETTING_UPDATE_ENTRY, { field, key, value } as SettingEntryPayload);
}
