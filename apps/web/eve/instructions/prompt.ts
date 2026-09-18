import { Effect, Result } from "effect";
import { defineDynamic, defineInstructions } from "eve/instructions";
import { runWeb } from "../../server/runtime.js";
import { host } from "../host.js";
import { pinnedState } from "../pinned-state.js";
import { sessionPrompt } from "../session-prompt.js";

/**
 * The prompt a session runs under and the standing context each of its
 * turns opens with. The prompt is composed once per session from the
 * workspace rows and stands for the session's life, and its content address
 * is kept in the session's state so every turn row names the prompt the
 * model actually reads; the standing context is the turn's own system-role
 * instruction, replaced each turn and remembered by none, so the history eve
 * keeps is the words that were said and never a stale roster. A session the
 * host does not admit runs under nothing.
 */
export default defineDynamic({
  events: {
    // The prompt reads the rows and writes nothing, and it resolves on the
    // same event the hook claims the record on, so ownership alone admits it.
    "session.started": (_event, ctx) => {
      // Pinned before anything awaits: the hash is written after the rows
      // are read, and a statement can hand the fiber back in another
      // session's context (`../pinned-state.ts`).
      const prompt = pinnedState(sessionPrompt);
      return runWeb(
        Effect.gen(function* () {
          const admitted = yield* host.admitStarting(ctx.session.auth, ctx.session.id);
          if (Result.isFailure(admitted)) return null;
          const turn = host.turnKindOf(ctx.session.auth);
          if (!turn) return null;
          const composed = yield* host.prompt(admitted.success);
          prompt.update(() => ({ hash: composed.hash }));
          return defineInstructions({ content: composed.text });
        }),
      );
    },
    "turn.started": (_event, ctx) =>
      runWeb(
        Effect.gen(function* () {
          const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
          if (Result.isFailure(admitted)) return null;
          return defineInstructions({ content: yield* host.standingContext(admitted.success) });
        }),
      ),
  },
});
