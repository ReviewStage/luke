import { pageSandboxApp } from "@repo/service/pages/page-sandbox-app";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(pageSandboxApp());
