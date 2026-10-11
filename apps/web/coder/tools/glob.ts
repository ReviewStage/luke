/** eve's own `glob`, its paths resolved from the agent's checkout (`server/hosted/coder-host/files.ts`). */
import { CODER } from "../../server/hosted/coder-host/bounds.js";
import { globIn } from "../../server/hosted/coder-host/files.js";

export default globIn(CODER.CHECKOUT_PATH);
