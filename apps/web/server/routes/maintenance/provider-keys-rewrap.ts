import { providerKeyRewrapApp } from "../../provider-keys-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The rotation's rewrap of every stored provider key, asked by hand under the
 * deployment's `CRON_SECRET` (`scripts/rewrap-provider-keys.sh`). The logic
 * lives in `server/hosted/provider-key-rewrap.ts`, behind the group in
 * `server/provider-keys-app.ts`; this file only hands the group's export to
 * the route adaptor.
 */
export default routeFromHttpRouter(providerKeyRewrapApp());
