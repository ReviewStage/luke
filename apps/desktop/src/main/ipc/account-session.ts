import type { AccountSessionManager } from "@sidecar/account";
import { PRODUCT_ACCOUNT_ACT, PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { channels, isAccountProvider } from "#shared/contracts";

export interface AccountSessionIpcDependencies {
  ipcMain: Pick<IpcMain, "handle">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  accountSession: AccountSessionManager;
  recordProductEvent: RecordProductEvent;
  /**
   * Sends what is queued, now. Two acts here end the very account the counting
   * sender authenticates with, so a count of them has to leave before the act
   * does: queued behind a sign-out it waits until the next sign-in, and queued
   * behind a deletion it is dropped at the 401 and never sent at all — which
   * would leave churn visible only as people who stopped appearing.
   */
  flushProductEvents: () => Promise<void>;
}

export function registerAccountSessionIpc(dependencies: AccountSessionIpcDependencies): void {
  const { ipcMain, trustedSender, accountSession, recordProductEvent, flushProductEvents } =
    dependencies;
  // Which provider a sign-in was begun with is deliberately not counted. The
  // funnel wants how many begin against how many land, and `account:sign_in`
  // already marks the landing; naming the provider narrows the crowd an act
  // belongs to without answering a further question.
  ipcMain.handle(channels.beginSignIn, (event, provider: UnparsedWireValue) => {
    if (!trustedSender(event) || !isAccountProvider(provider)) {
      throw new Error("Invalid sign-in request");
    }
    recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, {
      account_act: PRODUCT_ACCOUNT_ACT.SIGN_IN_START,
    });
    return accountSession.beginSignIn(provider);
  });
  ipcMain.handle(channels.cancelSignIn, (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, {
      account_act: PRODUCT_ACCOUNT_ACT.SIGN_IN_CANCEL,
    });
    accountSession.cancelSignIn();
  });
  ipcMain.handle(channels.signOut, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, { account_act: PRODUCT_ACCOUNT_ACT.SIGN_OUT });
    await flushProductEvents();
    return accountSession.signOut({ revokeRemote: true });
  });
  ipcMain.handle(channels.deleteAccount, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, { account_act: PRODUCT_ACCOUNT_ACT.DELETE });
    await flushProductEvents();
    return accountSession.deleteEverywhere();
  });
}
