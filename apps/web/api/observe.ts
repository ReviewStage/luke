import { handleObserve } from "../server/hosted/observe.js";
import { hostedVaultRoute } from "../server/hosted/vault-route.js";

/** Observes the signed-in user's cloud sessions on demand. */
export default hostedVaultRoute(handleObserve);
