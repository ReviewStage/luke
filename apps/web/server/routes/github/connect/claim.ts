import { auth } from "../../../auth.js";
import { githubConnectionApp } from "../../../github-connection-app.js";
import { resolveHostedUserId } from "../../../hosted/bearer.js";
import { resolveBrowserSessionUserId } from "../../../hosted/browser-session.js";
import { githubUnlink } from "../../../hosted/github-unlink.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** The connect page claims a connect intent on the browser's own session (POST). */
export default routeFromHttpRouter(
  githubConnectionApp({
    resolveUserId: resolveHostedUserId,
    resolveSessionUserId: resolveBrowserSessionUserId,
    unlinkGitHub: githubUnlink(auth.api),
  }),
);
