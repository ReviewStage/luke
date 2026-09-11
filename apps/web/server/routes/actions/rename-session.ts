import { handleRenameSessionAction } from "../../hosted/action-session.js";
import { hostedVaultRoute } from "../../hosted/vault-route.js";

/** Renames an observed session itself — the chat. */
export default hostedVaultRoute(handleRenameSessionAction);
