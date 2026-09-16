import { handleConversationHistory } from "../../hosted/resource-reads.js";
import { hostedStoreRoute } from "../../hosted/store-route.js";

/** Reads the Conversation's history behind the caller's own cursor: the same view, newest first from the tail or the position named, grouped by turn. */
export default hostedStoreRoute(handleConversationHistory);
