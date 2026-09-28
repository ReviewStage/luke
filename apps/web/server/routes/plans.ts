import { HttpRouter } from "effect/unstable/http";
import { githubConnectionLayer } from "../hosted/github-connection.js";
import { resolveHostedUserId } from "../hosted/vault-route.js";
import { plansApp } from "../plans-app.js";
import { routeFromHttpRouter } from "../route-effect.js";

/** The account's named plans: list them (GET) or start one (POST). */
export default routeFromHttpRouter(
  plansApp({ resolveUserId: resolveHostedUserId }).pipe(
    HttpRouter.provideRequest(githubConnectionLayer),
  ),
);
