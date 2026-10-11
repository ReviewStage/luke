/** eve's own `read_file`, its paths resolved from the agent's checkout (`server/hosted/coder-host/files.ts`). */
import { CODER } from "../../server/hosted/coder-host/bounds.js";
import { readFileIn } from "../../server/hosted/coder-host/files.js";

export default readFileIn(CODER.CHECKOUT_PATH);
