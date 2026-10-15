/** eve's own `write_file`, its paths resolved from the agent's checkout (`packages/service/src/agents/coder-host/files.ts`). */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { writeFileIn } from "@luke/service/agents/coder-host/files";

export default writeFileIn(CODER.CHECKOUT_PATH);
