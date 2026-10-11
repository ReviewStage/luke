/** The code extension's `apply_patch`, its paths resolved from the agent's checkout (`server/hosted/coder-host/files.ts`). */
import { CODER } from "../../server/hosted/coder-host/bounds.js";
import { applyPatchIn } from "../../server/hosted/coder-host/files.js";

export default applyPatchIn(CODER.CHECKOUT_PATH);
