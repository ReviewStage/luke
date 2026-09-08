import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import type { HostOperator } from "../gateway/host-operator";
import { registerBridge } from "../register-bridge";

/**
 * The account rows, proxied to the host that owns the account: the sign-in
 * flow, the refresh, the sign-out, and the deletion all run there, and the
 * counts of them are recorded there, ahead of the act they count. What stays
 * here is what only the client can do about them — stopping the recording
 * its renderers run before the account they file under is gone.
 */
export interface AccountSessionIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  host: Pick<HostOperator, "beginSignIn" | "cancelSignIn" | "signOut" | "deleteAccount">;
  /**
   * Stops recording before either act runs. Neither can wait for its own
   * account transition to be relayed: a sign-out reports itself before the
   * store clears, and a deletion awaits the hosted erasure first — so a
   * recording still running is one filed under a person who has left, or one
   * whose erasure is already queued, which it would recreate.
   */
  haltSessionReplay: () => void;
  /**
   * Re-answers what recording may do, for an act that did not happen. A halt
   * ahead of a refused sign-out or a failed deletion is one the account
   * transition never follows, so without this the panel stays halted while the
   * user is still signed in.
   */
  resumeSessionReplay: () => void;
}

export function registerAccountSessionIpc(dependencies: AccountSessionIpcDependencies): void {
  const { host, haltSessionReplay, resumeSessionReplay } = dependencies;
  registerBridge(
    BRIDGE,
    {
      beginSignIn: (_context, provider) => host.beginSignIn(provider),
      cancelSignIn: () => host.cancelSignIn(),
      async signOut() {
        haltSessionReplay();
        try {
          return await host.signOut();
        } catch (error) {
          resumeSessionReplay();
          throw error;
        }
      },
      async deleteAccount() {
        haltSessionReplay();
        try {
          // A deletion that landed stands recording down for the run; the
          // host says so on its replay event, which follows this answer.
          return await host.deleteAccount();
        } catch (error) {
          resumeSessionReplay();
          throw error;
        }
      },
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
