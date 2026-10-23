import { titleNativeAgent } from "@luke/service/agents/native-events/native-title";
import {
  runnerEventsApp,
  sandboxAtRunnerEnd,
  sandboxKeptAlive,
} from "@luke/service/agents/native-events/runner-events-app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where a native harness's runner posts its events (POST), admitted by the runner's own bearer rather than an account's; a run under way keeps its sandbox alive, a launch's end stops it, a turn's start or end names an untitled agent, and a call's ask stopped before its line was taken stops the turn it opened. The logic lives in `packages/service/src/agents/native-events/runner-events-app.ts`. */
export default routeFromHttpRouter(
  runnerEventsApp({ ended: sandboxAtRunnerEnd, alive: sandboxKeptAlive, title: titleNativeAgent }),
  // A call's ask stopped before its runner took its line stops that runner's turn from here.
  nativeAgents,
);
