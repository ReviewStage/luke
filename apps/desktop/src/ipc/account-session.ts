import type { UnparsedWireValue } from "@sidecar/core";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type { AccountSessionManager } from "../account-session-manager";
import { channels, isAccountProvider } from "../shared/contracts";

export interface AccountSessionIpcDependencies {
  ipcMain: Pick<IpcMain, "handle">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  accountSession: AccountSessionManager;
}

export function registerAccountSessionIpc(dependencies: AccountSessionIpcDependencies): void {
  const { ipcMain, trustedSender, accountSession } = dependencies;
  ipcMain.handle(channels.beginSignIn, (event, provider: UnparsedWireValue) => {
    if (!trustedSender(event) || !isAccountProvider(provider)) {
      throw new Error("Invalid sign-in request");
    }
    return accountSession.beginSignIn(provider);
  });
  ipcMain.handle(channels.cancelSignIn, (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    accountSession.cancelSignIn();
  });
  ipcMain.handle(channels.signOut, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return accountSession.signOut({ revokeRemote: true });
  });
  ipcMain.handle(channels.deleteAccount, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return accountSession.deleteEverywhere();
  });
}
