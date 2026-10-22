import { defineDynamic, defineInstructions } from "eve/instructions";
import { sessionSeed } from "../host.js";

/**
 * The conversation so far, for a session opened over a conversation that
 * already has words on record: our tables are the record, and a
 * session opened afresh because the agent's last one retired is seeded from
 * them once, as a user-role instruction eve appends to its durable history
 * at the session's start (`packages/service/src/agents/coder-host/host.ts`'s
 * `seed`). An agent's first session, over a conversation with nothing said
 * yet, is seeded with nothing.
 */
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const seed = await sessionSeed(ctx.session.auth, ctx.session.id);
      return seed === undefined ? null : defineInstructions({ content: seed, role: "user" });
    },
  },
});
