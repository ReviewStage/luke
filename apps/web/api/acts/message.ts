import { handleMessageAct } from "../../server/hosted/act-session.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/** Sends a message to an observed cloud session. */
export default hostedVaultRoute(handleMessageAct);
