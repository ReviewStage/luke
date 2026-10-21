import {
  runnerEventsApp,
  sandboxAtRunnerEnd,
} from "@luke/service/agents/native-events/runner-events-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where a native harness's runner posts its events (POST), admitted by the runner's own bearer rather than an account's; a launch's end stops its sandbox. The logic lives in `packages/service/src/agents/native-events/runner-events-app.ts`. */
export default routeFromHttpRouter(runnerEventsApp({ ended: sandboxAtRunnerEnd }));
