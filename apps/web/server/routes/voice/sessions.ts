import { voiceFunctionServer } from "../../voice/function.js";

/**
 * A signed-in desktop's GPT Live session, served as a WebSocket on this
 * function: created from the desktop's offer on the deployment's own key,
 * the sideband attached here, and events piped both ways. The logic lives in
 * `server/voice/`; this file only exports the server Vercel upgrades into.
 */
export default voiceFunctionServer();
