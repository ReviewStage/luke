/**
 * quit-dialog.ts -- the sheet a way out of Luke asks with while something would be lost: leave, or stay.
 */

import { LEAVE_ANSWER, type LeaveQuestion } from "@luke/host/quit";
import { app, type BrowserWindow, dialog, type MessageBoxOptions } from "electron";

/**
 * Asks `question`, as a sheet on the window while it is shown and on its own
 * while it is not, answering whether the developer chose to leave. Note
 * that the app comes forward first, because a quit chosen from the Dock
 * leaves it behind whatever is in front, and the question must be seen to
 * be answered.
 */
export async function askBeforeLeaving(
  window: BrowserWindow | undefined,
  question: LeaveQuestion,
): Promise<boolean> {
  if (process.platform === "darwin") app.focus({ steal: true });
  const options: MessageBoxOptions = {
    type: "warning",
    message: question.message,
    detail: question.detail,
    buttons: [...question.buttons],
    defaultId: question.defaultId,
    cancelId: question.cancelId,
  };
  const { response } =
    window !== undefined && window.isVisible()
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
  return response === LEAVE_ANSWER;
}
