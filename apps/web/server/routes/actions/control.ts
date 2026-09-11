import { handleControlAction } from "../../hosted/action-session.js";
import { hostedVaultRoute } from "../../hosted/vault-route.js";

/** Runs a control the session's latest observation advertised. */
export default hostedVaultRoute(handleControlAction);
