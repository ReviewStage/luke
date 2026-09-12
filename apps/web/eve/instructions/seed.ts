import { Effect } from "effect";
import { defineDynamic, defineInstructions } from "eve/instructions";
import { runWeb } from "../../server/runtime.js";
import { host } from "../host.js";

/**
 * The conversation so far, for a session opened over a conversation that
 * already has words on record: our tables are the record, and a new eve
 * session over an old conversation is seeded from them once, as a user-role
 * instruction eve appends to its durable history at the session's start.
 */
export default defineDynamic({
  events: {
    "session.started": (_event, ctx) =>
      runWeb(
        Effect.gen(function* () {
          const admitted = yield* host.admitStarting(ctx.session.auth, ctx.session.id);
          if (!admitted.ok) return null;
          const seed = yield* host.seed(admitted);
          return seed === undefined ? null : defineInstructions({ content: seed, role: "user" });
        }),
      ),
  },
});
