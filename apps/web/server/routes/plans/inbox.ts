import { orpcRoute } from "../../orpc-route.js";

/** One task's inbox, read past a cursor and held open while nothing changed (GET), answered by the hosted oRPC router (`packages/service/src/inbox/inbox-procedures.ts`). */
export default orpcRoute;
