import { handleConversationEvents } from "../../hosted/resource-reads.js";
import { hostedStoreRoute } from "../../hosted/store-route.js";

/** Reads the events about the Conversation's messages behind the caller's own cursor. */
export default hostedStoreRoute(handleConversationEvents);
