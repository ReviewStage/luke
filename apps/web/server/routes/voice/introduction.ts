import { voiceFunctionServer } from "../../voice/function.js";

/**
 * The accountless introduction's GPT Live session, served as a WebSocket on
 * this function under the function's own meter. The logic lives in
 * `server/voice/`; this file only exports the server Vercel upgrades into.
 */
export default voiceFunctionServer();
