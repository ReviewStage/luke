import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { githubTokenApp } from "@luke/service/github/github-token-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** The member's own GitHub personal access token: read what it is (GET), save one (PUT), or remove it (DELETE). */
export default routeFromHttpRouter(githubTokenApp({ resolveUserId: resolveHostedUserId }));
