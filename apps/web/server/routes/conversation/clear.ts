import { handleConversationClear } from "../../hosted/conversation-clear.js";
import { hostedStoreRoute } from "../../hosted/store-route.js";

/** Clear: stamps the account's main conversation deleted and opens a new one; the reads stop listing the stamped rows from the next call. */
export default hostedStoreRoute(handleConversationClear);
