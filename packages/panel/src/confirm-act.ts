/**
 * confirm-act.ts -- the act a question confirms, read from the caller's mutation, as `@repo/ui`'s `useConfirmDialog` takes it.
 *
 * The surface holding a question holds the act's `useMutation` itself, built
 * from the options its family hands or one of its own, and reads it here:
 * the act is out while the mutation is pending, and its newest answer says
 * whether it was refused. How it is sent is the caller's (`send`), the
 * mutation's `mutateAsync` with whatever the answer is heard by, so a tap on
 * the answer runs once per answer rather than on every draw. A refusal is
 * the mutation's answer read as one (`answered`), or its error where the act
 * refuses by failing (`failed`, as `actMutation`'s acts do). A refusal the
 * question says before anything is sent, a field left empty say, is held
 * here beside the mutation's, until the next answer or until it is let go.
 */

import type { ConfirmAct } from "@repo/ui/confirm-state";
import type { ActionResult } from "@repo/wire";
import { useState } from "react";

/** What a question reads of its act's mutation (`useMutation`'s result). */
export interface ConfirmMutation<Answer> {
  readonly isPending: boolean;
  readonly data: Answer | undefined;
  readonly error: Error | null;
  readonly reset: () => void;
}

/** How a question's act is sent through its mutation, and its answer read as the act's own. */
export interface ConfirmSend<Answer> {
  readonly send: () => Promise<unknown>;
  readonly answered: (answer: Answer) => ActionResult;
  /** The refusal a failed send stands for, where the act refuses by failing; none draws no refusal for it. */
  readonly failed?: ((error: Error) => ActionResult) | undefined;
  /** Why the act is refused before anything is sent, where it is; none sends it. */
  readonly refusedFirst?: (() => ActionResult | undefined) | undefined;
}

/** An answer that is already the act's own. */
export function sameAnswer(answer: ActionResult): ActionResult {
  return answer;
}

/** The act `mutation` stands for, sent and read as `act` says. */
export function useConfirmAct<Answer>(
  mutation: ConfirmMutation<Answer>,
  act: ConfirmSend<Answer>,
): ConfirmAct {
  const [first, setFirst] = useState<ActionResult | undefined>(undefined);
  const { isPending, data, error, reset } = mutation;
  const answer =
    error !== null ? act.failed?.(error) : data === undefined ? undefined : act.answered(data);
  return {
    run: () => {
      const refusal = act.refusedFirst?.();
      setFirst(refusal);
      return refusal === undefined ? act.send() : Promise.resolve();
    },
    busy: isPending,
    refused: isPending ? undefined : (first ?? answer),
    reset: () => {
      setFirst(undefined);
      reset();
    },
  };
}
