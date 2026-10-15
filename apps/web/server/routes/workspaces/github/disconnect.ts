import { memberSeams, workspaceSeams } from "@luke/database/models/workspace-seams";
import { workspacesApp } from "@luke/service/accounts/workspaces-app";
import { auth } from "@luke/service/auth/auth";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { resolveBrowserSessionUserId } from "@luke/service/auth/browser-session";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** A workspace's GitHub organization disconnected (POST), by an owner or admin of it. */
export default routeFromHttpRouter(
  workspacesApp({
    resolveUserId: resolveHostedUserId,
    resolveSessionUserId: resolveBrowserSessionUserId,
    workspaces: workspaceSeams(auth.api),
    members: memberSeams(auth.api),
  }),
);
