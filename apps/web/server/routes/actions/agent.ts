import { handleAgentAction } from "../../hosted/action-session.js";
import { hostedVaultRoute } from "../../hosted/vault-route.js";

/** Starts another agent in the workspace an observed session runs in. */
export default hostedVaultRoute(handleAgentAction);
