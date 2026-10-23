/** eve's own `bash`, started in the agent's checkout rather than the sandbox's root, with its workspace's environment (`packages/service/src/agents/coder-host/shell.ts`), deepening the checkout first unless the command plainly only reads (`packages/service/src/agents/coder-host/deepen.ts`). */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { deepeningFirst } from "@luke/service/agents/coder-host/deepen";
import { bashStartingIn } from "@luke/service/agents/coder-host/shell";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { deepenCheckout, host, shellEnvironmentFor } from "../host.js";

export default deepeningFirst(
  CODER_TOOL.BASH,
  bashStartingIn(CODER.CHECKOUT_PATH, shellEnvironmentFor(host.admit)),
  deepenCheckout,
);
