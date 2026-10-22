/** `browser`, the Chromium in the agent's own sandbox (`packages/service/src/agents/browser/browser-tool.ts`). */
import { browserFor, host } from "../host.js";

export default browserFor(host.admit);
