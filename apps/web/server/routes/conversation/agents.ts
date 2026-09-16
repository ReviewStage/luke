import { handleConversationAgents } from "../../hosted/resource-reads.js";
import { hostedStoreRoute } from "../../hosted/store-route.js";

/** Reads the account's agents as they stand: the observed conversations holding a turn, the one that changed last first and bounded, with no cursor. */
export default hostedStoreRoute(handleConversationAgents);
