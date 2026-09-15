import { handleBrainNotebook } from "../../hosted/notebook-read.js";
import { hostedStoreRoute } from "../../hosted/store-route.js";

/** Reads the account's notebook — Luke's curated memory files and his newest dated notes — whole and bounded. */
export default hostedStoreRoute(handleBrainNotebook);
