import { providerKeyRewrapApp } from "@repo/service/accounts/provider-keys-app";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(providerKeyRewrapApp());
