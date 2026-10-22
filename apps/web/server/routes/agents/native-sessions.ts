import { nativeRelayApp } from "@luke/service/agents/coder-host/native-relay-app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where an eve app's call to a native harness is made (POST), admitted by the deployment's own secret alone, on the harnesses this function launches (`native-agents.ts`). The logic lives in `packages/service/src/agents/coder-host/native-relay-app.ts`. */
export default routeFromHttpRouter(nativeRelayApp(), nativeAgents);
