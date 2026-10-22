import { browserLiveFunctionServer } from "../../terminal/function.js";

/**
 * A member's live view of one of a task's agents' Browser tabs, served as a
 * WebSocket on this function: the desktop under its bearer, the web app
 * under its session cookie. The logic lives in `@luke/service/browser-live`;
 * this file only exports the server Vercel upgrades into.
 */
export default browserLiveFunctionServer();
