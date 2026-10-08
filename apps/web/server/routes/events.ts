import { eventsApp } from "../events-app.js";
import { routeFromHttpRouter } from "../route-effect.js";

/**
 * Records what the signed-in desktop counted about its own use. The logic
 * lives in `server/hosted/events.ts`, behind the group in
 * `server/events-app.ts`; this file only hands the group's export to the
 * route adaptor.
 */
export default routeFromHttpRouter(eventsApp());
