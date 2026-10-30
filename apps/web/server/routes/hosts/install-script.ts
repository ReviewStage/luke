import { hostInstallScriptApp } from "@luke/service/agents/host-install-script-app";
import template from "../../../install/install.sh?raw";
import { routeFromHttpRouter } from "../../route-effect.js";

/**
 * Serves the host's install script, which the web service rewrites
 * `/install.sh` onto (`function-rewrites.ts`), so its command names the
 * origin it was fetched from. The script's text is `install/install.sh`,
 * inlined into the function's bundle (`function-bundles.ts`); the logic lives
 * in `packages/service/src/agents/host-install-script-app.ts`, and this file
 * only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(hostInstallScriptApp(template));
