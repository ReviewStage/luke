/** eve's own `write_file`, its paths resolved from the agent's checkout (`packages/service/src/agents/coder-host/files.ts`), deepening the checkout first (`packages/service/src/agents/coder-host/deepen.ts`), and offered at each turn's start only to an agent working in a repository (`repositoryToolsOf`). */
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { deepeningFirst } from "@luke/service/agents/coder-host/deepen";
import { writeFileIn } from "@luke/service/agents/coder-host/files";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { defineDynamic } from "eve/tools";
import { deepenCheckout, offeredRepositoryTools } from "../host.js";

const tool = deepeningFirst(
  CODER_TOOL.WRITE_FILE,
  writeFileIn(CODER.CHECKOUT_PATH),
  deepenCheckout,
);

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredRepositoryTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.WRITE_FILE)
        ? tool
        : null,
  },
});
