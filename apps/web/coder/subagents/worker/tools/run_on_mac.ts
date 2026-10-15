/** `run_on_mac`, a command run on the developer's own Mac, admitted on ownership as the worker's resolvers are (`packages/service/src/agents/mac-command.ts`). */
import { host, runOnMacFor } from "../../../host.js";

export default runOnMacFor(host.admitDelegated);
