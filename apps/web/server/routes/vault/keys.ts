import { handleVaultKeysList } from "../../hosted/vault.js";
import { hostedVaultRoute } from "../../hosted/vault-route.js";

/** Lists stored provider keys for the signed-in user — ids and timestamps, never keys. */
export default hostedVaultRoute(handleVaultKeysList);
