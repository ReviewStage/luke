import { linearAppSeams } from "../../../hosted/linear-seams.js";
import { linearApp } from "../../../linear-app.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * Begins a browser sign-in to Linear for the account. The logic lives in
 * `server/linear-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpRouter(linearApp(linearAppSeams()));
