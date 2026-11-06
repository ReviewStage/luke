import type { ConfirmAct } from "@repo/ui/confirm-state";
import type { ActionResult } from "@repo/wire";
import { useState } from "react";

export interface ConfirmMutation<Answer> {
  readonly isPending: boolean;
  readonly data: Answer | undefined;
  readonly error: Error | null;
  readonly reset: () => void;
}

export interface ConfirmSend<Answer> {
  readonly send: () => Promise<unknown>;
  readonly answered: (answer: Answer) => ActionResult;
  readonly failed?: ((error: Error) => ActionResult) | undefined;
  readonly refusedFirst?: (() => ActionResult | undefined) | undefined;
}

export function sameAnswer(answer: ActionResult): ActionResult {
  return answer;
}

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
