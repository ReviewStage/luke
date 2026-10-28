import { runnerLinesApp } from "@luke/service/agents/native-events/runner-lines-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where a cloud runner reads Luke's lines past its cursor (GET), admitted by the runner's own bearer rather than an account's, and held while none stands past it. The logic lives in `packages/service/src/agents/native-events/runner-lines-app.ts`; this file only hands it to the deployment. */
export default routeFromHttpRouter(runnerLinesApp());
