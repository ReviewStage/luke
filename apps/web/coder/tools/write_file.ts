/** eve's own `write_file`, its paths resolved from the agent's checkout (`server/hosted/coder-host/files.ts`). */
import { CODER } from "../../server/hosted/coder-host/bounds.js";
import { writeFileIn } from "../../server/hosted/coder-host/files.js";

export default writeFileIn(CODER.CHECKOUT_PATH);
