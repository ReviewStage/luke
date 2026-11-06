import { LEAVE_ANSWER, type LeaveQuestion } from "@repo/host/quit";
import { app, type BrowserWindow, dialog, type MessageBoxOptions } from "electron";

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
