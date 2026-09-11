import { hostedStoreRoute } from "../../../hosted/store-route.js";
import { handleTurnEventStream } from "../../../hosted/turn-event-stream.js";

/** Streams one turn's run seams to the account that owns it, as Server-Sent Events, until the turn ends. */
export default hostedStoreRoute(handleTurnEventStream);
