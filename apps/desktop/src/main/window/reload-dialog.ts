import { PRODUCT_NAME } from "@repo/features/product-name";
import { app, type BrowserWindow, dialog, type MessageBoxOptions } from "electron";
import { MAXIMUM_REVIVALS_PER_LOAD } from "./renderer-revival";

const RELOAD_ANSWER = 0;

const RELOAD_OR_QUIT: MessageBoxOptions = {
  type: "error",
  message: `${PRODUCT_NAME}'s window stopped working`,
  detail: `It reloaded ${MAXIMUM_REVIVALS_PER_LOAD} times and still couldn't load.`,
  buttons: ["Reload", `Quit ${PRODUCT_NAME}`],
  defaultId: RELOAD_ANSWER,
  cancelId: RELOAD_ANSWER,
};

export async function askReloadPanel(window: BrowserWindow): Promise<boolean> {
  if (process.platform === "darwin") app.focus({ steal: true });
  window.show();
  const { response } = await dialog.showMessageBox(window, RELOAD_OR_QUIT);
  return response === RELOAD_ANSWER;
}
