import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { EMPTY_RELAY_STATE, type RelayState } from "@luke/service/agents/brain-host/relay";
import { Effect, Result } from "effect";
import { defineState } from "eve/context";
import { defineHook } from "eve/hooks";
import { host } from "../host.js";
import { runAgent } from "../runtime.js";
import { chatHanded, sessionPrompt } from "../session-prompt.js";

/**
 * The relay from eve's stream into the store: every event eve records for a
 * session is read here, after eve has written it, and told to the writer as
 * the brain's own event. The state a turn accumulates between events lives
 * in eve's durable session state, so a step eve replays finds what the
 * first attempt kept. A session the host does not admit writes nothing, and
 * a session the conversation has rotated away from is one the host does not
 * admit: its start claims the record only forward, and every later event is
 * admitted only while the record is still its own. An event the relay
 * passes over, or folds into its state alone, such as a fragment of a
 * step's reasoning or of a sentence not yet finished, is folded without
 * the admission, which reads the store for each event it admits.
 */

const relayState = defineState<RelayState>("luke.relay", () => EMPTY_RELAY_STATE);

export default defineHook({
  events: {
    "*"(event, ctx) {
      // Pinned before anything awaits, because the admission's statement can
      // hand this fiber back in another session's context, and the relay's
      // state and the prompt's hash are this session's (`packages/service/src/agents/brain-host/pinned-state.ts`).
      const state = pinnedState(relayState);
      const prompt = pinnedState(sessionPrompt);
      const handed = pinnedState(chatHanded);
      return runAgent(
        Effect.gen(function* () {
          if (event.type === "session.started") {
            const starting = yield* host.admitStarting(ctx.session.auth, ctx.session.id);
            if (Result.isFailure(starting)) return;
            if (!(yield* host.sessionStarted(starting.success, ctx.session.id))) return;
          }
          // A fragment the store need hear nothing of is folded into the relay's state without
          // admitting the session, whose reads would otherwise run for every one of them.
          if (host.relaysQuietly(event, state)) return;
          const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
          if (Result.isFailure(admitted)) return;
          yield* host.relay(
            event,
            admitted.success,
            ctx.session,
            state,
            prompt.get(),
            handed.get(),
          );
        }),
      );
    },
  },
});
