import { handleRenameSessionAction } from "../../server/hosted/action-session.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/** Renames an observed session itself — the chat. */
export default hostedVaultRoute(handleRenameSessionAction);
