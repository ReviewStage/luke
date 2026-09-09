import { getDatabase } from "../server/db/index.js";
import { deviceSeams } from "../server/hosted/device-store.js";
import { handleDevices } from "../server/hosted/devices.js";
import { hostedVaultRoute } from "../server/hosted/vault-route.js";

/**
 * Registers (POST), heartbeats (PUT), and forgets (DELETE) the signed-in
 * installation's device row. The logic lives in `server/hosted/devices.ts`
 * and the writes in `server/hosted/device-store.ts`; this file only hands
 * them the deployment's real database.
 */
export default hostedVaultRoute((route) =>
  handleDevices({
    request: route.request,
    resolveUserId: route.resolveUserId,
    ...deviceSeams(getDatabase()),
  }),
);
