/**
 * new-task-planning.ts -- whether New task starts a task with its planning phase, kept across launches.
 *
 * A task started with planning opens as the account's plan template and
 * opens its call with Luke; one started without opens an empty plan and no
 * call, for work the developer already knows how to say. The choice is the
 * window's own, as the sidebar's fold is (`../desktop/sidebar-collapse.ts`):
 * main never reads it, so it is kept in the renderer's storage rather than
 * crossing to the settings file, and the next New task offers it as it was
 * left. Until it is changed, a task starts with planning, as every task did
 * before the choice was offered.
 */

import { useEffect, useState } from "react";

/** The storage key the choice is kept under. */
const NEW_TASK_PLANNING_KEY = "luke.new-task-planning";

/** The kept choice: with planning unless it was turned off, or storage refuses the read. */
function readPlanning(): boolean {
  try {
    return window.localStorage.getItem(NEW_TASK_PLANNING_KEY) !== "false";
  } catch {
    return true;
  }
}

/** The choice New task offers and a setter that keeps it for the next one. */
export function useNewTaskPlanning(): readonly [boolean, (planning: boolean) => void] {
  const [planning, setPlanning] = useState(readPlanning);
  // A write that fails costs only the preference, so it is not worth a word
  // on screen.
  useEffect(() => {
    try {
      window.localStorage.setItem(NEW_TASK_PLANNING_KEY, String(planning));
    } catch {
      // The dialog keeps the choice for as long as it stands.
    }
  }, [planning]);
  return [planning, setPlanning];
}
