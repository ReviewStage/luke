/** eve's own `glob`, its paths resolved from the agent's checkout (`packages/service/src/agents/coder-host/files.ts`). */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { globIn } from "@luke/service/agents/coder-host/files";

export default globIn(CODER.CHECKOUT_PATH);
