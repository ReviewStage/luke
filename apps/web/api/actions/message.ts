import { handleMessageAction } from "../../server/hosted/action-session.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/** Sends a message to an observed cloud session. */
export default hostedVaultRoute(handleMessageAction);
