import { observationApp } from "../observation-app.js";
import { routeFromHttpApp } from "../route-effect.js";

/** Lists where the signed-in user's keys can create a workspace. */
export default routeFromHttpApp(observationApp());
