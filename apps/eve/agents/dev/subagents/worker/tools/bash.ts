/** eve's own `bash`, started in the agent's checkout as the agent's is (`packages/service/src/agents/coder-host/shell.ts`); the worker is told to change nothing with it. */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { bashStartingIn } from "@luke/service/agents/coder-host/shell";

export default bashStartingIn(CODER.CHECKOUT_PATH);
