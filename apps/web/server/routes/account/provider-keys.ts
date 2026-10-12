import { resolveHostedUserId } from "../../hosted/bearer.js";
import { providerKeysApp } from "../../provider-keys-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** The account's own provider API keys: read what they are (GET), save one (PUT), or remove one (DELETE). */
export default routeFromHttpRouter(providerKeysApp({ resolveUserId: resolveHostedUserId }));
