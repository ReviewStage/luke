/**
 * eve's own `bash`, started in the agent's checkout as the agent's is, with
 * its workspace's environment, admitted on ownership as the worker's
 * resolvers are, and with no network
 * (`packages/service/src/agents/coder-host/shell.ts`), so nothing the worker
 * runs reaches GitHub through the session's token at the firewall, or the
 * internet at all; the checkout's history is fetched for it first where a
 * command may reach git (`deepen.ts`'s rule, `../../../host.ts`'s
 * `fetchWorkerHistory`), since a worker may start before the agent's first
 * write deepens the shallow checkout.
 */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { deepeningFirst } from "@luke/service/agents/coder-host/deepen";
import { bashStartingIn, SHELL_NETWORK } from "@luke/service/agents/coder-host/shell";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { fetchWorkerHistory, host, shellEnvironmentFor } from "../../../host.js";

export default deepeningFirst(
  CODER_TOOL.BASH,
  bashStartingIn(CODER.CHECKOUT_PATH, SHELL_NETWORK.NONE, shellEnvironmentFor(host.admitDelegated)),
  fetchWorkerHistory,
);
