import { accountApp } from "@luke/service/accounts/account-app";
import { accountAppSeams } from "@luke/service/accounts/account-seams";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** One revision of the account's plan template beside the one before it, by the number its path carries (GET). */
export default routeFromHttpRouter(accountApp(accountAppSeams()));
