/**
 * quit-dialog.ts -- the question a quit asks while a call stands: end the call and quit, or stay.
 */

import { app, type BrowserWindow, dialog, type MessageBoxOptions } from "electron";

/** The answer that quits: the default button, which Return presses. */
const QUIT_ANSWER = 0;

const END_CALL_AND_QUIT: MessageBoxOptions = {
  type: "warning",
  message: "End the call and quit Luke?",
  buttons: ["End call and quit", "Cancel"],
  defaultId: QUIT_ANSWER,
  cancelId: 1,
};

/**
 * Asks, as a sheet on the window while it is shown and on its own while it
 * is not, whether to end the call and quit. Note that the app comes forward
 * first, because a quit chosen from the Dock leaves it behind whatever is in
 * front, and the question must be seen to be answered.
 */
export async function askEndCallAndQuit(window: BrowserWindow | undefined): Promise<boolean> {
  if (process.platform === "darwin") app.focus({ steal: true });
  const { response } =
    window !== undefined && window.isVisible()
      ? await dialog.showMessageBox(window, END_CALL_AND_QUIT)
      : await dialog.showMessageBox(END_CALL_AND_QUIT);
  return response === QUIT_ANSWER;
}
