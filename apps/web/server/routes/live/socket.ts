import { liveSocketFunctionServer } from "../../terminal/function.js";

/**
 * A signed-in host's live polls, served as one WebSocket on this function:
 * the desktop under its bearer, the web app under its session cookie, each
 * ask answered as its HTTP poll under `/api/live/` would be. The logic lives
 * in `@repo/service/live/live-socket`; this file only exports the server
 * Vercel upgrades into.
 */
export default liveSocketFunctionServer();
