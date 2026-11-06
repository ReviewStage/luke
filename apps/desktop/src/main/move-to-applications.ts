import { PRODUCT_NAME } from "@repo/features/product-name";
import { buildCarriesDeveloperIdSigning } from "@repo/host/app-identity";
import { jsonStateFile } from "@repo/host/node";
import { text } from "@repo/wire";
import { app, dialog } from "electron";
import type { DesktopConfig } from "./services/desktop-config";

const MOVE_ANSWER = { MOVE: 0, NOT_NOW: 1 } as const;

export function moveToApplications(): void {
  if (!buildCarriesDeveloperIdSigning()) {
    throw new Error("Only a release build moves itself into Applications.");
  }
  app.moveToApplicationsFolder();
}

export async function offerMoveToApplications(config: DesktopConfig): Promise<boolean> {
  if (
    !config.packaged ||
    !buildCarriesDeveloperIdSigning() ||
    !config.runMode.sendsNetwork ||
    config.platform !== "darwin"
  ) {
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
