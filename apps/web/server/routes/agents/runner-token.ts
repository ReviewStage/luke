import { runnerTokenApp } from "@luke/service/agents/native-events/runner-token-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where a Codex runner's token command asks for its starter's ChatGPT plan's access token (POST), admitted by the runner's own bearer rather than an account's. The logic lives in `packages/service/src/agents/native-events/runner-token-app.ts`. */
export default routeFromHttpRouter(runnerTokenApp());
