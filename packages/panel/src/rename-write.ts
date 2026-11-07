/**
 * rename-write.ts -- a rename's write as its caller's mutation stands, as `@repo/ui`'s `useInlineRename` takes it.
 *
 * The surface holding a rename holds the act's `useMutation` itself, built
 * from the options its family hands (a task's, an agent's, a shell's), and
 * reads it here: the newest name asked is the mutation's `variables`, and a
 * refusal its error or, for an act whose answer says it, that answer. A
 * refusal said in a toast is said through the call's own `onSettled`, which
 * hears the newest call alone, so a rename a later one replaced says nothing.
 */

import type { RenameWrite } from "@repo/ui/use-inline-rename";
import type { UseMutationResult } from "@tanstack/react-query";

/** How a rename is asked of a mutation, read back from it, and found refused in its answer; and what a refusal of the newest says, where it says anything. */
export interface RenameShape<Answer, Variables> {
  readonly ask: (subjectId: string, name: string) => Variables;
  readonly asked: (variables: Variables) => { readonly subjectId: string; readonly name: string };
  readonly refused: (answer: Answer) => boolean;
  readonly onRefused?:
    | ((
        answer: Answer | undefined,
        error: Error | null,
        asked: { readonly subjectId: string; readonly name: string },
      ) => void)
    | undefined;
}

/** The rename `mutation` stands as, its names asked and read through `shape`. */
export function renameWrite<Answer, Variables>(
  mutation: UseMutationResult<Answer, Error, Variables>,
  shape: RenameShape<Answer, Variables>,
): RenameWrite {
  const { mutate, reset, variables, data, error, isPending } = mutation;
  const { onRefused } = shape;
  const refusedBy = (answer: Answer | undefined, failed: Error | null) =>
    failed !== null || (answer !== undefined && shape.refused(answer));
  return {
    run: (subjectId, name) => {
      const asked = shape.ask(subjectId, name);
      if (onRefused === undefined) return mutate(asked);
      mutate(asked, {
        onSettled: (answer, failed, variables) => {
          if (refusedBy(answer, failed)) onRefused(answer, failed, shape.asked(variables));
        },
      });
    },
    asked: variables === undefined ? undefined : shape.asked(variables),
    refused: !isPending && refusedBy(data, error),
    reset,
  };
}
