/**
 * new-task-mode.ts -- whether New task starts a coding agent on the words or plans them with Luke, kept across launches.
 *
 * In Agent mode the words in New task's box are a coding agent's prompt: the
 * task starts with an empty plan and no call, and an agent starts on it. In
 * Plan mode the task starts as the account's plan template and opens its
 * call with Luke, as every task did before the agent came first. The choice
 * is the window's own, as the sidebar's fold is
 * (the desktop's `sidebar-collapse.ts`): main never reads it, so it is kept in
 * the renderer's storage rather than crossing to the settings file, and the
 * next New task offers it as it was left. Note that it is kept under a key
 * of its own, never the old Plan switch's, so a switch turned on long ago
 * does not land anyone in Plan mode: until it is changed, New task is in
 * Agent mode.
 */

import { useEffect, useState } from "react";

/** What New task starts: a coding agent on the words, or a plan and a call with Luke. */
export const NEW_TASK_MODE = {
  AGENT: "agent",
  PLAN: "plan",
} as const;

export type NewTaskMode = (typeof NEW_TASK_MODE)[keyof typeof NEW_TASK_MODE];

/** The storage key the choice is kept under. */
const NEW_TASK_MODE_KEY = "luke.new-task-mode";

/** The kept choice: Plan mode where it was left there, else Agent mode, as where storage refuses the read. */
function readMode(): NewTaskMode {
  try {
    return window.localStorage.getItem(NEW_TASK_MODE_KEY) === NEW_TASK_MODE.PLAN
      ? NEW_TASK_MODE.PLAN
      : NEW_TASK_MODE.AGENT;
  } catch {
    return NEW_TASK_MODE.AGENT;
  }
}

/** The mode New task offers and a setter that keeps it for the next one. */
export function useNewTaskMode(): readonly [NewTaskMode, (mode: NewTaskMode) => void] {
  const [mode, setMode] = useState(readMode);
  // A write that fails costs only the preference, so it is not worth a word
  // on screen.
  useEffect(() => {
    try {
      window.localStorage.setItem(NEW_TASK_MODE_KEY, mode);
    } catch {
      // The card keeps the choice for as long as it stands.
    }
  }, [mode]);
  return [mode, setMode];
}
