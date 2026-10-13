import { githubConnectionApp } from "../../github-connection-app.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { resolveBrowserSessionUserId } from "../../hosted/browser-session.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A connect intent for the bearer's account (POST), answered with the page that links GitHub. */
export default routeFromHttpRouter(
  githubConnectionApp({
    resolveUserId: resolveHostedUserId,
    resolveSessionUserId: resolveBrowserSessionUserId,
  }),
);
