import { observationApp } from "../observation-app.js";
import { routeFromHttpRouter } from "../route-effect.js";

/** Observes the signed-in user's cloud sessions on demand. */
export default routeFromHttpRouter(observationApp());
