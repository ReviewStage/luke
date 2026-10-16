/** eve's own `read_file`, its paths resolved from the agent's checkout as the agent's own is (`packages/service/src/agents/coder-host/files.ts`). */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { readFileIn } from "@luke/service/agents/coder-host/files";

export default readFileIn(CODER.CHECKOUT_PATH);
