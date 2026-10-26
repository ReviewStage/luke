import { defineDynamic, defineInstructions } from "eve/instructions";
import { delegatedInstructions } from "../../host.js";

/**
 * The worker's standing rules, kept beside the agent's
 * (`packages/service/src/agents/coder-host/instructions.ts`), worded at the
 * session's start for the agent's repository, or for its working folder
 * where it has none; a session the host does not admit as a worker's runs
 * under nothing, and its model resolver fails it.
 */
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const content = await delegatedInstructions(ctx.session.auth, ctx.session.id);
      return content === undefined ? null : defineInstructions({ content });
    },
  },
});
