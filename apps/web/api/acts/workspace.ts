import { handleWorkspaceAct } from "../../server/hosted/act-session.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/** Creates a workspace in a cloud project the caller's keys reported. */
export default hostedVaultRoute(handleWorkspaceAct);
