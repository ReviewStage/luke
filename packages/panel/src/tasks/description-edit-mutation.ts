/**
 * description-edit-mutation.ts -- every write to a description's words as one mutation per description: the editor's saves, and the ticks and dates written from the words at rest.
 *
 * Each place that writes a description's words holds a `useMutation` of its own over
 * these options, and all of them run in the order asked, one at a time, as
 * the Mutations guide's `scope` runs every mutation of one scope id: a save
 * never overlaps another of the same description, whichever place sent it. The
 * write answers saved, a conflict with the text as it stands now, or why
 * not; how it is sent is its family's (`useTasksTab`'s `descriptionEdit`).
 */

import type { DescriptionEditRequest } from "@repo/features/description-edit";
import type { TasksEditAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { mutationOptions } from "@tanstack/react-query";

/** How a description's write is sent: the request, answered as the service answers it. */
export type DescriptionEditSend = (request: DescriptionEditRequest) => Promise<TasksEditAnswer>;

/** The key and the scope every write to `taskId`'s words runs under, one at a time in the order asked. */
function descriptionWritesOf(taskId: string) {
  return { mutationKey: [ACT_KIND.TASKS_EDIT, taskId], scope: { id: taskId } };
}

/** Every write to `taskId`'s words, sent through `send`, in the order asked. */
export function descriptionEditMutation(taskId: string, send: DescriptionEditSend) {
  return mutationOptions({ ...descriptionWritesOf(taskId), mutationFn: send });
}

/** A description's writes, as each place writing them holds them (`descriptionEditMutation`). */
export type DescriptionEditMutation = ReturnType<typeof descriptionEditMutation>;

/**
 * A write to `taskId`'s words made from them at rest, a tick or a date, in
 * its turn among every other write to them: `write` runs once each write
 * before it settles, so the text it writes over is the one they left, and
 * sends through `edit`, the description's own send.
 */
export function descriptionAtRestMutation<Asked, Answer>(
  taskId: string,
  edit: DescriptionEditMutation,
  write: (asked: Asked, send: DescriptionEditSend) => Promise<Answer>,
) {
  const send = edit.mutationFn;
  return mutationOptions({
    ...descriptionWritesOf(taskId),
    mutationFn: (asked: Asked, context) =>
      write(asked, (request) =>
        send === undefined
          ? Promise.reject(new Error("The description's writes name no send."))
          : send(request, context),
      ),
  });
}
