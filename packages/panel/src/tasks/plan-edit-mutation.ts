/**
 * plan-edit-mutation.ts -- every write to a plan's words as one mutation per plan: the editor's saves, and the ticks and dates written from the words at rest.
 *
 * Each place that writes a plan's words holds a `useMutation` of its own over
 * these options, and all of them run in the order asked, one at a time, as
 * the Mutations guide's `scope` runs every mutation of one scope id: a save
 * never overlaps another of the same plan, whichever place sent it. The
 * write answers saved, a conflict with the text as it stands now, or why
 * not; how it is sent is its family's (`useTasksTab`'s `planEdit`).
 */

import type { DescriptionEditRequest } from "@repo/features/description-edit";
import type { TasksEditAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { mutationOptions } from "@tanstack/react-query";

/** How a plan's write is sent: the request, answered as the service answers it. */
export type PlanEditSend = (request: DescriptionEditRequest) => Promise<TasksEditAnswer>;

/** Every write to `taskId`'s words, sent through `send`, in the order asked. */
export function planEditMutation(taskId: string, send: PlanEditSend) {
  return mutationOptions({
    mutationKey: [ACT_KIND.TASKS_EDIT, taskId],
    mutationFn: send,
    scope: { id: taskId },
  });
}

/** A plan's writes, as each place writing them holds them (`planEditMutation`). */
export type PlanEditMutation = ReturnType<typeof planEditMutation>;
