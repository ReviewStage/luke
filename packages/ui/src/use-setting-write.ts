import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useEffect, useRef, useState } from "react";

/** What a write says when it failed with no sentence of its own: the call itself rejected rather than answered. */
const WRITE_FAILED_WORDS = "That didn't go through. Try again.";

/** The sentence a failed write carries: a refusal's own, else the words for a call that never answered. */
function failureWords(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : WRITE_FAILED_WORDS;
}

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
    // Note that a rejected call settles the row as a refusal does, because a
    // control left resting until an answer that never comes is locked for good.
    void reply.then(
      (result) => {
        const accepted = result.status === ACTION_RESULT_STATUS.ACCEPTED;
        setRejection(accepted ? undefined : result.reason);
        if (accepted) setSaves((landed) => landed + 1);
        setBusy(false);
      },
      (error: unknown) => {
        setRejection(failureWords(error));
        setBusy(false);
      },
    );
  };
  return { busy, rejection, saves, run } satisfies {
    busy: boolean;
    rejection: string | undefined;
    saves: number;
    run: (value: Value) => void;
  };
}

/**
 * The round trip a switch waits on, answered before it comes. The switch
 * shows the value pressed at once, from a local one, rather than resting
 * until the store answers; a write the store refuses, or whose call
 * rejects, puts the value back and says why through `onRefused`, and the
 * switch is never disabled for it, so nothing locks it. The local value is
 * dropped once the stored one agrees, so the switch then follows the store
 * again, other windows' changes included.
 *
 * Note that only the newest write puts the value back: an older one refused
 * after a later press must not undo it, though its refusal is still said.
 * A change that answers void is a draft's, which the caller's own state
 * already shows, so nothing is held for it.
 */
export function useOptimisticSettingWrite<Value>(
  stored: Value,
  // biome-ignore lint/suspicious/noConfusingVoidType: a draft's switch cannot be refused, so its change answers void
  onChange: (value: Value) => void | Promise<ActionResult>,
  onRefused: (reason: string) => void,
) {
  const [ahead, setAhead] = useState<{ readonly value: Value }>();
  const [saves, setSaves] = useState(0);
  const newest = useRef(0);
  useEffect(() => {
    if (ahead !== undefined && Object.is(ahead.value, stored)) setAhead(undefined);
  }, [ahead, stored]);
  const run = (value: Value) => {
    const reply = onChange(value);
    if (!(reply instanceof Promise)) return;
    const write = ++newest.current;
    setAhead({ value });
    const refused = (reason: string) => {
      onRefused(reason);
      if (write === newest.current) setAhead(undefined);
    };
    void reply.then(
      (result) => {
        if (result.status === ACTION_RESULT_STATUS.ACCEPTED) setSaves((landed) => landed + 1);
        else refused(result.reason);
      },
      (error: unknown) => refused(failureWords(error)),
    );
  };
  return { value: ahead === undefined ? stored : ahead.value, saves, run };
}

export function actionRejection(result: ActionResult): string | undefined {
  return result.status === ACTION_RESULT_STATUS.ACCEPTED ? undefined : result.reason;
}
