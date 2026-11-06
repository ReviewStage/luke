export const NEW_TASK_PURPOSE = {
  TASK: "task",
  AUTOMATION: "automation",
} as const;

export type NewTaskPurpose = (typeof NEW_TASK_PURPOSE)[keyof typeof NEW_TASK_PURPOSE];
