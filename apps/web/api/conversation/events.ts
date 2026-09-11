import { handleConversationEvents } from "../../server/hosted/resource-reads.js";
import { hostedStoreRoute } from "../../server/hosted/store-route.js";

/** Reads the events about the Conversation's messages behind the caller's own cursor. */
export default hostedStoreRoute(handleConversationEvents);
