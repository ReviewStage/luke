import { devicesVaultApp } from "../devices-vault-app.js";
import { productionDevicesVaultSeams } from "../hosted/vault-route.js";
import { routeFromHttpApp } from "../route-effect.js";

/**
 * Registers (POST), heartbeats (PUT), and forgets (DELETE) the signed-in
 * installation's device row, and stores, lists, and deletes the provider key
 * vault. The logic lives in `server/devices-vault-app.ts`; this file only
 * hands it the deployment's real seams.
 */
export default routeFromHttpApp(devicesVaultApp(productionDevicesVaultSeams()));
