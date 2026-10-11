/** eve's own `bash`, started in the agent's checkout as the agent's is (`server/hosted/coder-host/shell.ts`); the worker is told to change nothing with it. */
import { CODER } from "../../../../server/hosted/coder-host/bounds.js";
import { bashStartingIn } from "../../../../server/hosted/coder-host/shell.js";

export default bashStartingIn(CODER.CHECKOUT_PATH);
