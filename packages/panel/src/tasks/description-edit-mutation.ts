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

/** Every write to `taskId`'s words, sent through `send`, in the order asked. */
export function descriptionEditMutation(taskId: string, send: DescriptionEditSend) {
  return mutationOptions({
    mutationKey: [ACT_KIND.TASKS_EDIT, taskId],
    mutationFn: send,
    scope: { id: taskId },
  });
}

/** A description's writes, as each place writing them holds them (`descriptionEditMutation`). */
export type DescriptionEditMutation = ReturnType<typeof descriptionEditMutation>;
