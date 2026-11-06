import { hostInstallScriptApp } from "@repo/service/agents/host-install-script-app";
import template from "../../../install/install.sh?raw";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(hostInstallScriptApp(template));
