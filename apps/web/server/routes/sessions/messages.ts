import { observationApp } from "../../observation-app.js";
import { routeFromHttpApp } from "../../route-effect.js";

/** Reads one observed session's conversation for the caller who opened its screen. */
export default routeFromHttpApp(observationApp());
