import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { AppSettingField, AppSettingValue, SettingsUpdateResult } from "@repo/settings/wire";
import { STATUS_TONE } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { actFailureWords } from "../act.js";
import { type SettingWrite, settingMutation } from "../act-mutations.js";
import { showToast, TOAST_HOLD } from "../toast.js";

export interface SettingRefusal {
  readonly words: string;
  readonly cause: unknown;
}

export interface RowWrite<Value> {
  readonly run: (value: Value) => void;
  readonly ahead: { readonly value: Value } | undefined;
  readonly busy: boolean;
  readonly refusal: SettingRefusal | undefined;
  readonly savedAt: number;
  readonly settle: () => void;
}

interface RowWriteShape<Value, Answer, Variables> {
  readonly ask: (value: Value) => Variables;
  readonly refused: (answer: Answer) => string | undefined;
  readonly drawn?: ((variables: Variables) => Value) | undefined;
}

export type RowChange<Value> =
  | { readonly write: RowWrite<Value>; readonly onChange?: undefined }
  | { readonly onChange: (value: Value) => void; readonly write?: undefined };

function refusalOf<Answer>(
  answer: Answer | undefined,
  error: Error | null,
  refused: (answer: Answer) => string | undefined,
): SettingRefusal | undefined {
  if (error !== null) return { words: actFailureWords(error), cause: error };
  const words = answer === undefined ? undefined : refused(answer);
  return words === undefined ? undefined : { words, cause: answer };
}

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

export function actionRefused(answer: ActionResult): string | undefined {
  return answer.status === ACTION_RESULT_STATUS.ACCEPTED ? undefined : answer.reason;
}

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
