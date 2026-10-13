import { accountApp } from "../../../account-app.js";
import { accountAppSeams } from "../../../hosted/account-seams.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** One revision of the account's plan template put back as the template (POST). */
export default routeFromHttpRouter(accountApp(accountAppSeams()));
