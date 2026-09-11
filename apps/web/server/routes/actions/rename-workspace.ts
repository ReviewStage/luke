import { handleRenameWorkspaceAction } from "../../hosted/action-session.js";
import { hostedVaultRoute } from "../../hosted/vault-route.js";

/** Renames the workspace an observed session runs in. */
export default hostedVaultRoute(handleRenameWorkspaceAction);
