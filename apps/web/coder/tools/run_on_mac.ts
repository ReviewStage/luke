/** `run_on_mac`, a command run on the developer's own Mac (`server/hosted/mac-command.ts`). */
import { host, runOnMacFor } from "../host.js";

export default runOnMacFor(host.admit);
