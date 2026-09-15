import { handleConversationChildren } from "../../hosted/resource-reads.js";
import { hostedStoreRoute } from "../../hosted/store-route.js";

/** Reads the account's children as they stand: the conversations a delegation opened, newest first and bounded, with no cursor. */
export default hostedStoreRoute(handleConversationChildren);
