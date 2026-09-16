import { handleConversationAgents } from "../../hosted/resource-reads.js";
import { hostedStoreRoute } from "../../hosted/store-route.js";

/** Reads the account's agents as they stand: the observed conversations holding a turn, latest turn first and bounded, with no cursor. */
export default hostedStoreRoute(handleConversationAgents);
