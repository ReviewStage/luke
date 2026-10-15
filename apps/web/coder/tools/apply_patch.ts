/** The code extension's `apply_patch`, its paths resolved from the agent's checkout (`packages/service/src/agents/coder-host/files.ts`). */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { applyPatchIn } from "@luke/service/agents/coder-host/files";

export default applyPatchIn(CODER.CHECKOUT_PATH);
