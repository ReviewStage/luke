import { handleWorkspaceAction } from "../../hosted/action-session.js";
import { hostedVaultRoute } from "../../hosted/vault-route.js";

/** Creates a workspace in a cloud project the caller's keys reported. */
export default hostedVaultRoute(handleWorkspaceAction);
