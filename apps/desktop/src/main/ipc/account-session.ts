import type { AccountSessionManager } from "@sidecar/account";
import { PRODUCT_ACCOUNT_ACT, PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import { registerBridge } from "../register-bridge";

export interface AccountSessionIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
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
  /**
   * Stops recording before either act runs. Neither can wait for its own
   * account transition to be broadcast: a sign-out reports itself before the
   * store clears, and a deletion awaits the hosted erasure first — so a
   * recording still running is one filed under a person who has left, or one
   * whose erasure is already queued, which it would recreate.
   */
  haltSessionReplay: () => void;
  /**
   * Re-answers what recording may do, for an act that did not happen. A halt
   * ahead of a refused sign-out or a failed deletion is one the account
   * transition never follows, so without this the panel stays halted while the
   * user is still signed in — and no settings change can lift it, because they
   * all re-apply the same stale answer.
   */
  resumeSessionReplay: () => void;
}

export function registerAccountSessionIpc(dependencies: AccountSessionIpcDependencies): void {
  const {
    accountSession,
    recordProductEvent,
    flushProductEvents,
    haltSessionReplay,
    resumeSessionReplay,
  } = dependencies;
  // Which provider a sign-in was begun with is deliberately not counted. The
  // funnel wants how many begin against how many land, and `account:sign_in`
  // already marks the landing; naming the provider narrows the crowd an act
  // belongs to without answering a further question.
  registerBridge(
    BRIDGE,
    {
      beginSignIn(provider) {
        recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, {
          account_act: PRODUCT_ACCOUNT_ACT.SIGN_IN_START,
        });
        return accountSession.beginSignIn(provider);
      },
      cancelSignIn() {
        recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, {
          account_act: PRODUCT_ACCOUNT_ACT.SIGN_IN_CANCEL,
        });
        accountSession.cancelSignIn();
      },
      async signOut() {
        recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, {
          account_act: PRODUCT_ACCOUNT_ACT.SIGN_OUT,
        });
        haltSessionReplay();
        await flushProductEvents();
        try {
          return await accountSession.signOut({ revokeRemote: true });
        } catch (error) {
          resumeSessionReplay();
          throw error;
        }
      },
      async deleteAccount() {
        recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, { account_act: PRODUCT_ACCOUNT_ACT.DELETE });
        haltSessionReplay();
        await flushProductEvents();
        try {
          return await accountSession.deleteEverywhere();
        } catch (error) {
          resumeSessionReplay();
          throw error;
        }
      },
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
