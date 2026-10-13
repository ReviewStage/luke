import { accountApp } from "../../../account-app.js";
import { accountAppSeams } from "../../../hosted/account-seams.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** One revision of the account's plan template beside the one before it, by the number its path carries (GET). */
export default routeFromHttpRouter(accountApp(accountAppSeams()));
