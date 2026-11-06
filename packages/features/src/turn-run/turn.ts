export const TURN_TRIGGER = {
  ASK: "ask",
  CHILD_TASK: "child-task",
} as const;

export type TurnTrigger = (typeof TURN_TRIGGER)[keyof typeof TURN_TRIGGER];
