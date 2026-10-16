import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { Effect, Result } from "effect";
import { defineDynamic, defineInstructions } from "eve/instructions";
import { host } from "../host.js";
import { runAgent } from "../runtime.js";
import { sessionPrompt } from "../session-prompt.js";

/**
 * The instructions a session runs under, set once at its start and standing
 * for the session's life, with the content address kept in the session's
 * state so every turn row names the prompt the model actually reads. The
 * plan itself is the session's first message and no instruction. A session
 * the host does not admit, or whose conversation is no agent's, runs under
 * nothing.
 */
export default defineDynamic({
  events: {
    "session.started": (_event, ctx) => {
      // Pinned before anything awaits: the hash is written after the
      // admission is read, and a statement can hand the fiber back in another
      // session's context (`packages/service/src/agents/brain-host/pinned-state.ts`).
      const prompt = pinnedState(sessionPrompt);
      return runAgent(
        Effect.gen(function* () {
          const admitted = yield* host.admitStarting(ctx.session.auth, ctx.session.id);
          if (Result.isFailure(admitted)) return null;
          const agent = yield* host.agent(admitted.success);
          if (Result.isFailure(agent)) return null;
          const composed = yield* host.prompt(admitted.success, agent.success);
          prompt.update(() => ({
            hash: composed.hash,
            ciReadable: composed.ciReadable,
            ...(composed.coAuthor === undefined ? undefined : { coAuthor: composed.coAuthor }),
            workspace: composed.workspace,
          }));
          return defineInstructions({ content: composed.text });
        }),
      );
    },
  },
});
