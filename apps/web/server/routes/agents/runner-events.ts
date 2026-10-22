import { titleNativeAgent } from "@luke/service/agents/native-events/native-title";
import {
  runnerEventsApp,
  sandboxAtRunnerEnd,
  sandboxKeptAlive,
} from "@luke/service/agents/native-events/runner-events-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where a native harness's runner posts its events (POST), admitted by the runner's own bearer rather than an account's; a run under way keeps its sandbox alive, a launch's end stops it, and a turn's start or end names an untitled agent. The logic lives in `packages/service/src/agents/native-events/runner-events-app.ts`. */
export default routeFromHttpRouter(
  runnerEventsApp({ ended: sandboxAtRunnerEnd, alive: sandboxKeptAlive, title: titleNativeAgent }),
);
