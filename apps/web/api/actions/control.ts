import { handleControlAction } from "../../server/hosted/action-session.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/** Runs a control the session's latest observation advertised. */
export default hostedVaultRoute(handleControlAction);
