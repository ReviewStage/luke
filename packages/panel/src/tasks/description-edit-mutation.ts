import type { DescriptionEditRequest } from "@repo/features/description-edit";
import type { TasksEditAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { mutationOptions } from "@tanstack/react-query";

export type DescriptionEditSend = (request: DescriptionEditRequest) => Promise<TasksEditAnswer>;

function descriptionWritesOf(taskId: string) {
  return { mutationKey: [ACT_KIND.TASKS_EDIT, taskId], scope: { id: taskId } };
}

export function descriptionEditMutation(taskId: string, send: DescriptionEditSend) {
  return mutationOptions({ ...descriptionWritesOf(taskId), mutationFn: send });
}

export type DescriptionEditMutation = ReturnType<typeof descriptionEditMutation>;

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
