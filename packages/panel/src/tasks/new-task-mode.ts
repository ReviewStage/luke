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

import { useSyncExternalStore } from "react";

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

/** Every mounted card's hearing of the mode, told each time one of them turns it. */
const listeners = new Set<() => void>();

/** A turn storage refused to keep, which the window holds for as long as it stands. */
let unkept: NewTaskMode | undefined;

/** The mode as the window holds it now: storage's, read afresh, unless it refused the last turn. */
function modeNow(): NewTaskMode {
  return unkept ?? readMode();
}

function hear(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Turns the mode for every card standing and keeps it for the next one. */
function turn(mode: NewTaskMode): void {
  // A write that fails costs only the preference, so it is not worth a word
  // on screen; the window keeps the choice for as long as it stands.
  try {
    window.localStorage.setItem(NEW_TASK_MODE_KEY, mode);
    unkept = undefined;
  } catch {
    unkept = mode;
  }
  for (const listener of listeners) listener();
}

/**
 * The mode New task offers and a setter that keeps it for the next one. Note
 * that the cards standing at once, Home's and the dialog's over it, read one
 * mode, so a turn in one is the other's too.
 */
export function useNewTaskMode(): readonly [NewTaskMode, (mode: NewTaskMode) => void] {
  return [useSyncExternalStore(hear, modeNow), turn];
}
