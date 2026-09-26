import { HttpRouter } from "effect/unstable/http";
import { githubApp } from "../../github-app.js";
import { githubAccessWithoutConnections } from "../../hosted/github-source.js";
import { resolveHostedUserId } from "../../hosted/vault-route.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** The repositories the account's GitHub connection can read (GET), for a new plan's picker. */
export default routeFromHttpRouter(
  githubApp({ resolveUserId: resolveHostedUserId }).pipe(
    HttpRouter.provideRequest(githubAccessWithoutConnections),
  ),
);
