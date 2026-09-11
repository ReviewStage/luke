import { handleObserve } from "../hosted/observe.js";
import { hostedVaultRoute } from "../hosted/vault-route.js";

/** Observes the signed-in user's cloud sessions on demand. */
export default hostedVaultRoute(handleObserve);
