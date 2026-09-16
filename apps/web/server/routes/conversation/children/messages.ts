import { handleConversationChildMessages } from "../../../hosted/resource-reads.js";
import { hostedStoreRoute } from "../../../hosted/store-route.js";

/** Reads one child's or observed conversation's messages behind a device's own cursor: the Conversation's projection over the one conversation the query names. */
export default hostedStoreRoute(handleConversationChildMessages);
