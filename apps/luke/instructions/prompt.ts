import { eveTurnIdOf } from "@luke/service/agents/brain-host/host";
import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Effect, Result } from "effect";
import { defineDynamic, defineInstructions } from "eve/instructions";
import { host } from "../host.js";
import { runAgent } from "../runtime.js";
import { chatHanded, sessionPrompt } from "../session-prompt.js";

/**
 * The prompt a session runs under and the standing context each of its
 * turns opens with. The prompt is set once per session and stands for the
 * session's life, and its content address is kept in the session's state so
 * every turn row names the prompt the model actually reads; the standing
 * context is the turn's own system-role instruction, replaced each turn and
 * remembered by none, so the history eve keeps is the words that were said
 * and never a stale document; what it hands of the chat is kept in the
 * session's state until the turn settles (`../hooks/store.ts`). A session
 * the host does not admit runs under nothing.
 */
export default defineDynamic({
  events: {
    // The prompt writes nothing, and it resolves on the same event the hook
    // claims the record on, so ownership alone admits it.
    "session.started": (_event, ctx) => {
      // Pinned before anything awaits: the hash is written after the
      // admission is read, and a statement can hand the fiber back in another
      // session's context (`packages/service/src/agents/brain-host/pinned-state.ts`).
      const prompt = pinnedState(sessionPrompt);
      return runAgent(
        Effect.gen(function* () {
          const admitted = yield* host.admitStarting(ctx.session.auth, ctx.session.id);
          if (Result.isFailure(admitted)) return null;
          const turn = host.turnKindOf(ctx.session.auth);
          if (!turn) return null;
          const composed = host.prompt();
          prompt.update(() => ({ hash: composed.hash }));
          return defineInstructions({ content: composed.text });
        }),
      );
    },
    "turn.started": (event, ctx) => {
      // Pinned before anything awaits, as the prompt's hash is above.
      const handed = pinnedState(chatHanded);
      return runAgent(
        Effect.gen(function* () {
          const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
          if (Result.isFailure(admitted)) return null;
          const standing = yield* host.standingContext(admitted.success);
          // SAFETY: eve hands a resolver the JSON event it recorded; the host reads it as wire input.
          const eveTurnId = eveTurnIdOf(unparsedWire(event as WireBoundaryInput));
          handed.update(() => ({
            ...(eveTurnId === undefined ? undefined : { eveTurnId }),
            ...(standing.chatThrough === undefined ? undefined : { through: standing.chatThrough }),
          }));
          return defineInstructions({ content: standing.text });
        }),
      );
    },
  },
});
