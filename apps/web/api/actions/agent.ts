import { handleAgentAction } from "../../server/hosted/action-session.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/** Starts another agent in the workspace an observed session runs in. */
export default hostedVaultRoute(handleAgentAction);
