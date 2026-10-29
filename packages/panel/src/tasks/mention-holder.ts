/**
 * mention-holder.ts -- what holds a place's mentions: a task's page, or the page of an agent on no task.
 *
 * A task's page offers its plan's sections and pages, and draws a section
 * of its own plan as found or gone; an agent's own page offers the pages
 * it showed itself, which stand on the agent rather than a task. A place
 * neither holds, as New task's composer and the window's Inbox are, has no
 * holder, and offers neither.
 */

/**
 * What holds a place's mentions: the task whose page it is, by its id, or
 * the agent on no task whose page it is, by its own, which its pages stand
 * on. A place neither holds, as New task's composer and the window's Inbox
 * are, has none.
 */
export type MentionHolder = { readonly taskId: string } | { readonly agentId: string };

/** The task a holder is, where it is one. */
export function holderTaskId(holder: MentionHolder | undefined): string | undefined {
  return holder !== undefined && "taskId" in holder ? holder.taskId : undefined;
}
