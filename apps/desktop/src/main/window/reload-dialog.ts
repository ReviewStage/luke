/**
 * reload-dialog.ts -- the question the panel asks once its renderer gave up loading: reload once more, or quit.
 */

import { app, type BrowserWindow, dialog, type MessageBoxOptions } from "electron";
import { MAXIMUM_REVIVALS_PER_LOAD } from "./renderer-revival";

/** The answer that reloads: the default button, which Return and Esc both press, so no key quits. */
const RELOAD_ANSWER = 0;

const RELOAD_OR_QUIT: MessageBoxOptions = {
  type: "error",
  message: "Luke's window stopped working",
  detail: `It reloaded ${MAXIMUM_REVIVALS_PER_LOAD} times and still couldn't load. Reload to try again, or quit Luke.`,
  buttons: ["Reload", "Quit Luke"],
  defaultId: RELOAD_ANSWER,
  cancelId: RELOAD_ANSWER,
};

/**
 * Asks, as a sheet on the window, whether to reload it once more. The window
 * is shown first, because a renderer that never loaded never showed it, and
 * a blank window with no question on it is what this is here to end.
 */
export async function askReloadPanel(window: BrowserWindow): Promise<boolean> {
  if (process.platform === "darwin") app.focus({ steal: true });
  window.show();
  const { response } = await dialog.showMessageBox(window, RELOAD_OR_QUIT);
  return response === RELOAD_ANSWER;
}
