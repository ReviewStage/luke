import { orpcRoute } from "../../orpc-route.js";

/** One pull request's chapters read (GET) and generated (POST) by its repository and number, for a pull request no agent opened, answered by the hosted oRPC router (`packages/service/src/chapters/pull-request-chapters-procedures.ts`); its function runs long enough for a generation (`function-durations.ts`). */
export default orpcRoute;
