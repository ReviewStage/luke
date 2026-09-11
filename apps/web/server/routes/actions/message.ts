import { handleMessageAction } from "../../hosted/action-session.js";
import { hostedVaultRoute } from "../../hosted/vault-route.js";

/** Sends a message to an observed cloud session. */
export default hostedVaultRoute(handleMessageAction);
