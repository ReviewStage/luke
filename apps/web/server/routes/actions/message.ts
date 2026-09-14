import { actionsApp } from "../../actions-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Every action endpoint, which is the group in `server/actions-app.ts`; this file only answers on this path. */
export default routeFromHttpRouter(actionsApp());
