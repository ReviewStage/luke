import { orpcRoute } from "../../../orpc-route.js";

/**
 * The issues of a repository a workspace's installation reaches, as New task's picker reads them: its open issues,
 * those a search finds, or one by its number, or that the installation grants the App none (GET), answered by the
 * hosted oRPC router (`packages/service/src/github/github-procedures.ts`).
 */
export default orpcRoute;
