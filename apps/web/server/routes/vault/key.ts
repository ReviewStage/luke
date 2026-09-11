import { handleVaultKeyDelete, handleVaultKeyStore } from "../../hosted/vault.js";
import { hostedVaultRoute } from "../../hosted/vault-route.js";

/** Stores or replaces one provider's key, and deletes it. */
export default hostedVaultRoute((route) =>
  route.request.method === "DELETE" ? handleVaultKeyDelete(route) : handleVaultKeyStore(route),
);
