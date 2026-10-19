import { orpcRoute } from "../../orpc-route.js";

/** A workspace's chat as a person in it reads it past a cursor, held open while nothing moved (GET), and writes to it (POST), answered by the hosted oRPC router (`packages/service/src/agents/messages-procedures.ts`). */
export default orpcRoute;
