import { accountApp } from "@luke/service/accounts/account-app";
import { accountAppSeams } from "@luke/service/accounts/account-seams";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** A page of the account's plan template history (GET). */
export default routeFromHttpRouter(accountApp(accountAppSeams()));
