import type { RenameWrite } from "@repo/ui/use-inline-rename";
import type { UseMutationResult } from "@tanstack/react-query";

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
