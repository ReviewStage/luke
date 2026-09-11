import { handleBrainTurns } from "../../hosted/resource-reads.js";
import { hostedStoreRoute } from "../../hosted/store-route.js";

/** Reads the account's turns in the order they last changed, behind the caller's own cursor. */
export default hostedStoreRoute(handleBrainTurns);
