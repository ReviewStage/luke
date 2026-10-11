/** eve's own `bash`, started in the agent's checkout rather than the sandbox's root (`server/hosted/coder-host/shell.ts`). */
import { CODER } from "../../server/hosted/coder-host/bounds.js";
import { bashStartingIn } from "../../server/hosted/coder-host/shell.js";

export default bashStartingIn(CODER.CHECKOUT_PATH);
