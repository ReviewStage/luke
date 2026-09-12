import { Effect } from "effect";
import { defineState } from "eve/context";
import { defineHook } from "eve/hooks";
import {
  EMPTY_RELAY_STATE,
  type RelayState,
  type RelayStateStore,
} from "../../server/hosted/brain-host/relay.js";
import { runWeb } from "../../server/runtime.js";
import { host } from "../host.js";
import { sessionPrompt } from "../session-prompt.js";

/**
 * The relay from eve's stream into the store: every event eve records for a
 * session is read here, after eve has written it, and told to the writer as
 * the brain's own event. The state a turn accumulates between events lives
 * in eve's durable session state, so a step eve replays finds what the
 * first attempt kept. A session the host does not admit writes nothing, and
 * a session the conversation has rotated away from is one the host does not
 * admit: its start claims the record only forward, and every later event is
 * admitted only while the record is still its own.
 */

const relayState = defineState<RelayState>("luke.relay", () => EMPTY_RELAY_STATE);

const state: RelayStateStore = {
  get: () => relayState.get(),
  update: (next) => relayState.update(next),
};

export default defineHook({
  events: {
    "*"(event, ctx) {
      return runWeb(
        Effect.gen(function* () {
          if (event.type === "session.started") {
            const starting = yield* host.admitStarting(ctx.session.auth, ctx.session.id);
            if (!starting.ok) return;
            if (!(yield* host.sessionStarted(starting, ctx.session.id))) return;
          }
          const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
          if (!admitted.ok) return;
          yield* host.relay(event, admitted, ctx.session, state, sessionPrompt.get());
        }),
      );
    },
  },
});
