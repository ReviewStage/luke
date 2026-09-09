import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useState } from "react";

/**
 * The round trip a settings control waits on. Each change is asked of the
 * store, the control rests until it answers rather than claiming a state it
 * may not get, and a refusal is kept here — under this control — rather than
 * on a line shared with every other row. One write in flight must not still
 * another control.
 *
 * Some choices cannot be refused (the voice, the pace): those answer void,
 * and there is nothing to rest for.
 */
export function useSettingWrite<Value>(
  // biome-ignore lint/suspicious/noConfusingVoidType: the voice and pace cannot be refused, so those writes answer void
  onChange: (value: Value) => void | Promise<ActionResult>,
) {
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string>();
  const run = (value: Value) => {
    const reply = onChange(value);
    if (!(reply instanceof Promise)) return;
    setBusy(true);
    void reply.then((result) => {
      setRejection(result.status === ACTION_RESULT_STATUS.ACCEPTED ? undefined : result.reason);
      setBusy(false);
    });
  };
  return { busy, rejection, run } satisfies {
    busy: boolean;
    rejection: string | undefined;
    run: (value: Value) => void;
  };
}

export function actionRejection(result: ActionResult): string | undefined {
  return result.status === ACTION_RESULT_STATUS.ACCEPTED ? undefined : result.reason;
}
