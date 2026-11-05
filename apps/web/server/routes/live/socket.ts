import { liveSocketFunctionServer } from "../../terminal/function.js";

/**
 * The live reads' WebSocket path, which refuses every upgrade for now, so a
 * host sends its live polls over HTTP under `/api/live/` instead
 * (`../../terminal/function.ts`). The logic lives in
 * `@repo/service/live/live-socket`; this file only exports the server
 * Vercel upgrades into.
 */
export default liveSocketFunctionServer();
