import { queueAtNativeTurnEnd } from "@repo/service/agents/coder-host/agent-queue";
import { titleNativeAgent } from "@repo/service/agents/native-events/native-title";
import {
  runnerEventsApp,
  sandboxAtRunnerEnd,
  sandboxAtRunnerIdle,
  sandboxKeptAlive,
} from "@repo/service/agents/native-events/runner-events-app";
import type { WebServices } from "@repo/service/runtime";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(
  runnerEventsApp<WebServices>({
    ended: sandboxAtRunnerEnd,
    idled: sandboxAtRunnerIdle,
    alive: sandboxKeptAlive,
    title: titleNativeAgent,
    turnEnded: queueAtNativeTurnEnd,
  }),
  nativeAgents,
);
