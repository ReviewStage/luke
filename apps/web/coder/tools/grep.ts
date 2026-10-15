/** The code extension's `grep`, its paths resolved from the agent's checkout (`packages/service/src/agents/coder-host/files.ts`). */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { grepIn } from "@luke/service/agents/coder-host/files";

export default grepIn(CODER.CHECKOUT_PATH);
