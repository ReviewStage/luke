import { devicesVaultApp } from "../../devices-vault-app.js";
import { productionDevicesVaultSeams } from "../../hosted/vault-route.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Lists stored provider keys for the signed-in user — ids and timestamps, never keys. */
export default routeFromHttpRouter(devicesVaultApp(productionDevicesVaultSeams()));
