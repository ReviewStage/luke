import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { resolveBrowserSessionUserId } from "@luke/service/auth/browser-session";
import { githubConnectionApp } from "@luke/service/github/github-connection-app";
import { githubUnlink } from "@luke/service/github/github-unlink";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Whether the bearer's account has connected its GitHub (GET). */
export default routeFromHttpRouter(
  githubConnectionApp({
    resolveUserId: resolveHostedUserId,
    resolveSessionUserId: resolveBrowserSessionUserId,
    unlinkGitHub: githubUnlink(auth.api),
  }),
);
