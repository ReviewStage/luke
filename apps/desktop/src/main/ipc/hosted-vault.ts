import type { HostedVaultClient } from "@sidecar/account";
import { ACT_RESULT_STATUS, type ActResult } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import { registerBridge } from "../register-bridge";

export interface HostedVaultIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  vault: HostedVaultClient;
}

/**
 * One refusal wording for every way a vault ask can fail — offline, signed
 * out, or the service standing the vault down. The client resolves them all
 * to no answer, deliberately: none is actionable here beyond trying again,
 * and a reason that guessed wrong would read as a diagnosis.
 */
const VAULT_REFUSAL: ActResult = {
  status: ACT_RESULT_STATUS.REJECTED,
  reason: "Luke's service did not take that. Check the connection and try again.",
};

const ACCEPTED: ActResult = { status: ACT_RESULT_STATUS.ACCEPTED };

/**
 * The desktop's three vault asks, each the direct product of a press on a
 * settings row. The key itself passes through here on its way to the service
 * and is held nowhere: not in settings, not in logs, not in the answer.
 */
export function registerHostedVaultIpc(dependencies: HostedVaultIpcDependencies): void {
  const { vault } = dependencies;
  registerBridge(
    BRIDGE,
    {
      async storeVaultKey(_context, providerId, key) {
        const answer = await vault.storeKey(providerId, key);
        return answer ? ACCEPTED : VAULT_REFUSAL;
      },
      requestVaultKeys: () => vault.listKeys(),
      async deleteVaultKey(_context, providerId) {
        const answer = await vault.deleteKey(providerId);
        // `deleted: false` is a key already gone, which is what the press
        // asked for — only a missing answer is a refusal.
        return answer ? ACCEPTED : VAULT_REFUSAL;
      },
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
