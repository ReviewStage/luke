import { handleRenameSessionAct } from "../../server/hosted/act-session.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/** Renames an observed session itself — the chat. */
export default hostedVaultRoute(handleRenameSessionAct);
