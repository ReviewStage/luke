/**
 * act-mutations.ts -- the `mutationOptions` factories every act a component or hook sends goes through.
 *
 * A write is a mutation, as the docs' Mutations guide has it: a surface calls
 * `useMutation` with one of these factories and sends the act with `mutate`
 * or `mutateAsync`, reading whether it is pending, failed, or done off the
 * mutation itself. Each factory is keyed by the act's own kind, a value of
 * the `as const` `ACT_KIND` (`[ACT_KIND.X]`), and its `mutationFn` sends the
 * act on the window's act port through `act.ts`, the port's one caller. There
 * are two, by who reads a failure:
 *
 * - `actMutation`: the caller reads the answer, and a refusal is the
 *   mutation's error, carrying the sentence the host drew for the caller to
 *   show. Sent with `mutate` and no `onError`, it stays quiet whatever comes
 *   back, for a report nobody pressed.
 * - `pressMutation`: a person pressed something. A refusal, or any other
 *   failure, raises the FAILED toast `pressAct` raises, so a press never fails
 *   silently, and reports it by the act's kind and the ids its payload names.
 */

import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import type { PortActKind } from "@repo/host/contract";
import { mutationOptions } from "@tanstack/react-query";
import { type ActResult, type ActVariables, sendAct, toastActFailure } from "./act.js";

/** One act as a mutation whose caller reads its answer and its failure. */
export function actMutation<Kind extends PortActKind>(kind: Kind) {
  return mutationOptions<ActResult<Kind>, Error, ActVariables<Kind>>({
    mutationKey: [kind],
    mutationFn: (variables) => sendAct(kind, variables),
  });
}

/** One act as a mutation a person pressed for, whose failure a FAILED toast says. */
export function pressMutation<Kind extends PortActKind>(kind: Kind) {
  return mutationOptions<ActResult<Kind>, Error, ActVariables<Kind>>({
    ...actMutation(kind),
    onError: (cause, variables) =>
      toastActFailure({
        surface: FAILURE_SURFACE.ACT,
        act: kind,
        cause,
        about: failureAboutOf(variables),
      }),
  });
}
