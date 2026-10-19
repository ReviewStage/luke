import { adminApp } from "@luke/service/admin/admin-app";
import { hostedAdminSeams } from "@luke/service/admin/admin-route";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * The admin Reliability screen's read. The gate and the read live behind the
 * group in `@luke/service/admin/admin-app`; this file only hands it the
 * deployment's real seams. Failures are answered as counts and fixed words,
 * and providers by whether their keys are present, never their values.
 */
export default routeFromHttpRouter(adminApp(hostedAdminSeams()));
