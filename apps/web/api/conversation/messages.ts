import { handleConversationMessages } from "../../server/hosted/resource-reads.js";
import { hostedStoreRoute } from "../../server/hosted/store-route.js";

/** Reads the Conversation's messages behind the caller's own cursor: the view over main and the observed conversations, grouped by turn. */
export default hostedStoreRoute(handleConversationMessages);
