import { pageSandboxApp } from "@luke/service/pages/page-sandbox-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One version of one page, served on the sandbox's own site to the link minted for it (GET). The logic lives in `packages/service/src/pages/page-sandbox-app.ts`; this file only stands it in a function of its own (`function-durations.ts`). */
export default routeFromHttpRouter(pageSandboxApp());
