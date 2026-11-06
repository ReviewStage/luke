import { workspaceSeams } from "@repo/database/models/workspace-seams";
import { auth } from "@repo/service/auth/auth";
import { authApp } from "@repo/service/auth/auth-app";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(
  authApp((request) => auth.handler(request), workspaceSeams(auth.api)),
);
