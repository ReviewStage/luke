import { devicesVaultApp } from "../../devices-vault-app.js";
import { productionDevicesVaultSeams } from "../../hosted/vault-route.js";
import { routeFromHttpApp } from "../../route-effect.js";

/** Stores or replaces one provider's key, and deletes it. */
export default routeFromHttpApp(devicesVaultApp(productionDevicesVaultSeams()));
