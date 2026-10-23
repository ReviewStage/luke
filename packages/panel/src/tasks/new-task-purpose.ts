/**
 * new-task-purpose.ts -- what New task's card starts: a task's coding agent, or the agent that makes an automation, which the Automations page's Create with an agent opens it for.
 */

export const NEW_TASK_PURPOSE = {
  TASK: "task",
  AUTOMATION: "automation",
} as const;

export type NewTaskPurpose = (typeof NEW_TASK_PURPOSE)[keyof typeof NEW_TASK_PURPOSE];
