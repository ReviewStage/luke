import { orpcRoute } from "../../orpc-route.js";

/** One worker's transcript past a cursor (GET), under the agent and the delegation call that started it, held open while the worker runs, answered by the hosted oRPC router (`packages/service/src/agents/messages-procedures.ts`). */
export default orpcRoute;
