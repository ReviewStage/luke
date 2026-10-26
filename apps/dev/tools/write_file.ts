/** eve's own `write_file`, its paths resolved from the agent's checkout, or the empty working folder of an agent with no repository (`packages/service/src/agents/coder-host/files.ts`), deepening the checkout first where there is one (`packages/service/src/agents/coder-host/deepen.ts`). */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { deepeningFirst } from "@luke/service/agents/coder-host/deepen";
import { writeFileIn } from "@luke/service/agents/coder-host/files";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { deepenCheckout } from "../host.js";

export default deepeningFirst(
  CODER_TOOL.WRITE_FILE,
  writeFileIn(CODER.CHECKOUT_PATH),
  deepenCheckout,
);
