import { handleRenameWorkspaceAct } from "../../server/hosted/act-session.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/** Renames the workspace an observed session runs in. */
export default hostedVaultRoute(handleRenameWorkspaceAct);
