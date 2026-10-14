import { terminalFunctionServer } from "../../terminal/function.js";

/**
 * A signed-in desktop's attached shell, served as a WebSocket on this
 * function and piped to the shell's PTY in its coding agent's sandbox. The
 * logic lives in `server/terminal/`; this file only exports the server
 * Vercel upgrades into.
 */
export default terminalFunctionServer();
