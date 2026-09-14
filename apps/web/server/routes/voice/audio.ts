import { voiceFunctionServer } from "../../voice/function.js";

/**
 * A signed-in device's GPT Live session for a device with no WebRTC of its
 * own, served as a WebSocket on this function: the service opens the
 * session's primary socket to OpenAI on the deployment's own key and pipes
 * the device's audio up and Luke's down beside the events. The logic lives in
 * `server/voice/`; this file only exports the server Vercel upgrades into.
 */
export default voiceFunctionServer();
