import { handleAgentAct } from "../../server/hosted/act-session.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/** Starts another agent in the workspace an observed session runs in. */
export default hostedVaultRoute(handleAgentAct);
