/** eve's own `bash`, started in the agent's checkout rather than the sandbox's root (`packages/service/src/agents/coder-host/shell.ts`). */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { bashStartingIn } from "@luke/service/agents/coder-host/shell";

export default bashStartingIn(CODER.CHECKOUT_PATH);
