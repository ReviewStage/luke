import { accountApp } from "@luke/service/accounts/account-app";
import { accountAppSeams } from "@luke/service/accounts/account-seams";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** One revision of the account's plan template put back as the template (POST). */
export default routeFromHttpRouter(accountApp(accountAppSeams()));
