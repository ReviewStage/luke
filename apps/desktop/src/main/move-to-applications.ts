/**
 * move-to-applications.ts -- moving the app into Applications, where Squirrel can replace it: asked once a version at launch, and pressed from the Updates row.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import { jsonStateFile } from "@repo/host/node";
import { text } from "@repo/wire";
import { app, dialog } from "electron";
import type { DesktopConfig } from "./services/desktop-config";

/** The launch question's answers, in the order its buttons are drawn. */
const MOVE_ANSWER = { MOVE: 0, NOT_NOW: 1 } as const;

/**
 * Moves the app into Applications. Note that a move that lands quits this
 * copy through the ordinary quit, its teardown and its questions included,
 * and opens the moved one once this process has left, so nothing here
 * quits; a move the developer cancelled at macOS's password prompt changes
 * nothing, and one that could not copy throws Electron's own words.
 */
export function moveToApplications(): void {
  app.moveToApplicationsFolder();
}

/**
 * Asks, before anything else stands, whether to move a packaged build
 * running outside Applications into it, because Squirrel cannot replace an
 * app on a disk image or a copy macOS translocated, and a copy anywhere else
 * outside Applications is most often one of those. Not now is kept for the
 * running version, so the question comes back with the next release rather
 * than at every launch. Answers whether the move landed, and so whether
 * this copy is already quitting.
 */
export async function offerMoveToApplications(config: DesktopConfig): Promise<boolean> {
  // Note that only a build that could update itself is asked, as the updater's own engine is built.
  if (!config.packaged || !config.runMode.sendsNetwork || config.platform !== "darwin") {
    return false;
  }
  if (app.isInApplicationsFolder()) return false;
  const declined = jsonStateFile<{ version: string }>({
    directory: () => config.stateRoot,
    fileName: "move-to-applications-declined.json",
    read: (record) => {
      const version = text(record.version);
      return version === undefined ? undefined : { version };
    },
    write: (state) => state,
    report: config.report,
  });
  if (declined.read()?.version === config.appVersion) return false;
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: `Move ${PRODUCT_NAME} to your Applications folder?`,
    detail: `${PRODUCT_NAME} keeps itself up to date from Applications. Moving it there opens it again from Applications.`,
    buttons: ["Move to Applications", "Not now"],
    defaultId: MOVE_ANSWER.MOVE,
    cancelId: MOVE_ANSWER.NOT_NOW,
  });
  if (response !== MOVE_ANSWER.MOVE) {
    declined.update(() => ({ version: config.appVersion }));
    return false;
  }
  try {
    return app.moveToApplicationsFolder();
  } catch (error) {
    config.report(
      `Could not move to Applications: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
