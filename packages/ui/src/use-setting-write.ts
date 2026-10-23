import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useState } from "react";

/**
 * The round trip a settings control waits on. Each change is asked of the
 * store, the control rests until it answers rather than claiming a state it
 * may not get, and a refusal is kept here — under this control — rather than
 * on a line shared with every other row. One write in flight must not still
 * another control.
 *
 * Some choices cannot be refused (the voice, the pace): those answer void,
 * and there is nothing to rest for. Each write the store accepts moves
 * `saves`, the count a row's `SavedTick` confirms it by, since a setting
 * written on change has no Save button to answer.
 */
export function useSettingWrite<Value>(
  // biome-ignore lint/suspicious/noConfusingVoidType: the voice and pace cannot be refused, so those writes answer void
  onChange: (value: Value) => void | Promise<ActionResult>,
) {
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string>();
  const [saves, setSaves] = useState(0);
  const run = (value: Value) => {
    const reply = onChange(value);
    if (!(reply instanceof Promise)) return;
    setBusy(true);
    void reply.then((result) => {
      const accepted = result.status === ACTION_RESULT_STATUS.ACCEPTED;
      setRejection(accepted ? undefined : result.reason);
      if (accepted) setSaves((landed) => landed + 1);
      setBusy(false);
    });
  };
  return { busy, rejection, saves, run } satisfies {
    busy: boolean;
    rejection: string | undefined;
    saves: number;
    run: (value: Value) => void;
  };
}

export function actionRejection(result: ActionResult): string | undefined {
  return result.status === ACTION_RESULT_STATUS.ACCEPTED ? undefined : result.reason;
}
