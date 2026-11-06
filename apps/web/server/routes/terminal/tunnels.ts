import { tunnelFunctionServer } from "../../terminal/function.js";

/**
 * A signed-in desktop's tunnel into its coding agent's sandbox, served as a
 * WebSocket on this function and piped to a bridge in the sandbox's PTY,
 * such as a forwarded port's. The logic lives in `@repo/service/tunnel`;
 * this file only exports the server Vercel upgrades into.
 */
export default tunnelFunctionServer();
