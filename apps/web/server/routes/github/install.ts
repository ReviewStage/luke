import { resolveBrowserSessionUserId } from "@repo/service/auth/browser-session";
import { githubInstallApp } from "@repo/service/github/github-install-app";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(
  githubInstallApp({ resolveSessionUserId: resolveBrowserSessionUserId }),
);
