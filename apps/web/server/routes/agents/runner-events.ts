import { queueAtNativeTurnEnd } from "@luke/service/agents/coder-host/agent-queue";
import { titleNativeAgent } from "@luke/service/agents/native-events/native-title";
import {
  runnerEventsApp,
  sandboxAtRunnerEnd,
  sandboxAtRunnerIdle,
  sandboxKeptAlive,
} from "@luke/service/agents/native-events/runner-events-app";
import type { WebServices } from "@luke/service/runtime";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where a native harness's runner posts its events (POST), admitted by the runner's own bearer rather than an account's; a run under way keeps its sandbox alive, a launch's IDLE retires its runner where the warm window is zero, a launch's end stops it and hands its waiting lines on, a turn's start or end names an untitled agent, and a turn's end hands on the agent's queue or pauses it. The logic lives in `packages/service/src/agents/native-events/runner-events-app.ts`. */
export default routeFromHttpRouter(
  runnerEventsApp<WebServices>({
    ended: sandboxAtRunnerEnd,
    idled: sandboxAtRunnerIdle,
    alive: sandboxKeptAlive,
    title: titleNativeAgent,
    turnEnded: queueAtNativeTurnEnd,
  }),
  // A launch's waiting lines are handed to a launch of their own from here.
  nativeAgents,
);
