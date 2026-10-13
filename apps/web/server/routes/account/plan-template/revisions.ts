import { accountApp } from "../../../account-app.js";
import { accountAppSeams } from "../../../hosted/account-seams.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** A page of the account's plan template history (GET). */
export default routeFromHttpRouter(accountApp(accountAppSeams()));
