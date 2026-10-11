/** The code extension's `grep`, its paths resolved from the agent's checkout as the agent's own is (`server/hosted/coder-host/files.ts`). */
import { CODER } from "../../../../server/hosted/coder-host/bounds.js";
import { grepIn } from "../../../../server/hosted/coder-host/files.js";

export default grepIn(CODER.CHECKOUT_PATH);
