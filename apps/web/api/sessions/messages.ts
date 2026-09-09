import { executeConversationRead } from "../../server/hosted/action-execute.js";
import { handleConversationRead } from "../../server/hosted/conversation-read.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/** Reads one observed session's conversation for the caller who opened its screen. */
export default hostedVaultRoute((route) =>
  handleConversationRead({ ...route, execute: executeConversationRead }),
);
