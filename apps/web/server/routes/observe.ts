import { observationApp } from "../observation-app.js";
import { routeFromHttpApp } from "../route-effect.js";

/** Observes the signed-in user's cloud sessions on demand. */
export default routeFromHttpApp(observationApp());
