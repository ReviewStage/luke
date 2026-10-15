import { eventsApp } from "@luke/service/events/events-app";
import { routeFromHttpRouter } from "../route-effect.js";

/**
 * Records what the signed-in desktop counted about its own use. The logic
 * lives in `packages/service/src/events/events.ts`, behind the group in
 * `packages/service/src/events/events-app.ts`; this file only hands the group's export to the
 * route adaptor.
 */
export default routeFromHttpRouter(eventsApp());
