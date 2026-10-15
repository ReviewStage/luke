import { providerKeysApp } from "@luke/service/accounts/provider-keys-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** The account's own provider API keys: read what they are (GET), save one (PUT), or remove one (DELETE). */
export default routeFromHttpRouter(providerKeysApp({ resolveUserId: resolveHostedUserId }));
