/** `browser`, the Chromium in its parent's sandbox, admitted on ownership as the worker's resolvers are (`packages/service/src/agents/browser/browser-tool.ts`). */
import { browserFor, host } from "../../../host.js";

export default browserFor(host.admitDelegated);
