/**
 * row-write.ts -- a settings row's write as its caller's mutation stands: what it asks for while out, why the newest was refused, and when it last landed.
 *
 * A row that writes takes the state of a `useMutation` its caller holds,
 * the setting's (`settingMutation`) or another act's, read through
 * `rowWrite`, so nothing of the row's keeps a write's pending or refusal of
 * its own. A switch draws the value the newest write asks for while it is
 * out, as the Optimistic Updates guide's "via the UI" draws a mutation's
 * `variables`, and goes on drawing it once landed until the stored value
 * agrees, since the document carrying it may arrive after the answer; a
 * refused write falls back to the stored value. A row whose change only
 * moves its caller's draft takes a plain `onChange` instead (`RowChange`).
 */

import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { AppSettingField, AppSettingValue, SettingsUpdateResult } from "@repo/settings/wire";
import { STATUS_TONE } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { actFailureWords } from "../act.js";
import { settingMutation } from "../act-mutations.js";
import { showToast, TOAST_HOLD } from "../toast.js";

/** Why a row's write was refused: its sentence, and the answer or the error that refused it. */
export interface SettingRefusal {
  readonly words: string;
  readonly cause: unknown;
}

/** A settings row's write, as its caller's mutation stands. */
export interface RowWrite<Value> {
  readonly run: (value: Value) => void;
  /** The value the newest write asks for, while it is out or landed; none once it is refused or let go of. */
  readonly ahead: { readonly value: Value } | undefined;
  readonly busy: boolean;
  /** Why the newest write was refused, once it answers. */
  readonly refusal: SettingRefusal | undefined;
  /** When the newest write landed, which a row's `SavedTick` confirms it by; none while it has not. */
  readonly savedAt: number;
  /** Lets go of a landed write, once the stored value agrees with it. */
  readonly settle: () => void;
}

/**
 * How a row's value is asked of a mutation, found refused in its answer,
 * and read back from what it asked, for a row that draws a write ahead of
 * its answer; none for a row that rests until it answers.
 */
interface RowWriteShape<Value, Answer, Variables> {
  readonly ask: (value: Value) => Variables;
  readonly refused: (answer: Answer) => string | undefined;
  readonly drawn?: ((variables: Variables) => Value) | undefined;
}

/** A row's change: its caller's write, or a plain change of its caller's draft. */
export type RowChange<Value> =
  | { readonly write: RowWrite<Value>; readonly onChange?: undefined }
  | { readonly onChange: (value: Value) => void; readonly write?: undefined };

/** Why `answer` or `error` refused a write, where either did. */
function refusalOf<Answer>(
  answer: Answer | undefined,
  error: Error | null,
  refused: (answer: Answer) => string | undefined,
): SettingRefusal | undefined {
  if (error !== null) return { words: actFailureWords(error), cause: error };
  const words = answer === undefined ? undefined : refused(answer);
  return words === undefined ? undefined : { words, cause: answer };
}

/** The row write `mutation` stands as, its values asked and read through `shape`. */
export function rowWrite<Value, Answer, Variables>(
  mutation: UseMutationResult<Answer, Error, Variables>,
  shape: RowWriteShape<Value, Answer, Variables>,
): RowWrite<Value> {
  const { mutate, reset, variables, data, error, isPending, isSuccess, submittedAt } = mutation;
  const refusal = isPending ? undefined : refusalOf(data, error, shape.refused);
  const { drawn } = shape;
  const ahead = variables !== undefined && refusal === undefined && drawn !== undefined;
  return {
    run: (value) => mutate(shape.ask(value)),
    ahead: ahead ? { value: drawn(variables) } : undefined,
    busy: isPending,
    refusal,
    savedAt: isSuccess && refusal === undefined ? submittedAt : 0,
    settle: reset,
  };
}

/** An act's answer refused, as the store or the service words it. */
export function actionRefused(answer: ActionResult): string | undefined {
  return answer.status === ACTION_RESULT_STATUS.ACCEPTED ? undefined : answer.reason;
}

/** What a setting's write asks: the field and its stored value. */
type SettingWrite = {
  readonly field: AppSettingField;
  readonly value: AppSettingValue<AppSettingField>;
};

/**
 * The write of the setting `field`, as its row's `useMutation(settingMutation())`
 * stands: the row's value stored as `stored` answers, and read back from the
 * stored value through `drawn` for a row that draws its write ahead.
 */
function settingRowWrite<Value>(
  mutation: UseMutationResult<SettingsUpdateResult, Error, SettingWrite>,
  field: AppSettingField,
  stored: (value: Value) => AppSettingValue<AppSettingField>,
  drawn?: (value: AppSettingValue<AppSettingField>) => Value,
): RowWrite<Value> {
  return rowWrite(mutation, {
    ask: (value) => ({ field, value: stored(value) }),
    refused: actionRefused,
    drawn: drawn === undefined ? undefined : (variables) => drawn(variables.value),
  });
}

/**
 * One row's write of the setting `field`, on a `useMutation(settingMutation())`
 * of its own, so a row's write in flight never stands in another's: its
 * value stored as `stored` answers, read back through `drawn` for a row
 * that draws its write ahead, and each refusal said in a toast where
 * `toasts` asks, as a switch's are.
 */
export function useSettingRowWrite<Value>(
  field: AppSettingField,
  stored: (value: Value) => AppSettingValue<AppSettingField>,
  drawn?: (value: AppSettingValue<AppSettingField>) => Value,
  toasts = false,
): RowWrite<Value> {
  const mutation = useMutation({
    ...settingMutation(),
    ...(toasts ? { onSettled: refusalToast(actionRefused) } : undefined),
  });
  return settingRowWrite(mutation, field, stored, drawn);
}

/**
 * Says each refused write of a switch in a FAILED toast, as a mutation's
 * `onSettled` hears every write, an older one refused after a later press
 * among them, where the switch draws the newest alone.
 */
export function refusalToast<Answer>(
  refused: (answer: Answer) => string | undefined,
): (answer: Answer | undefined, error: Error | null) => void {
  return (answer, error) => {
    const refusal = refusalOf(answer, error, refused);
    if (refusal === undefined) return;
    showToast({
      words: refusal.words,
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: { surface: FAILURE_SURFACE.SETTING_WRITE, cause: refusal.cause },
    });
  };
}
