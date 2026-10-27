import { runnerTokenApp } from "@luke/service/agents/native-events/runner-token-app";
import { resolveHostedBearerUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where a Codex runner's token command asks for its starter's ChatGPT plan's access token (POST), admitted by the runner's own bearer rather than an account's, and where a host or a sandboxed desktop asks for its agent's GitHub token. The logic lives in `packages/service/src/agents/native-events/runner-token-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(runnerTokenApp({ resolveUserId: resolveHostedBearerUserId }));
