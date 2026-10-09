import { defineState } from "eve/context";
import { defineHook } from "eve/hooks";
import { pinnedState } from "../../../../server/hosted/brain-host/pinned-state.js";
import { EMPTY_RELAY_STATE, type RelayState } from "../../../../server/hosted/brain-host/relay.js";
import { relayChildEvent } from "../../../host.js";

/**
 * The relay from the worker's own stream into the store: every event eve
 * records for the worker's child session is told to the writer under the
 * child conversation of the planning model's call that started it, so the
 * Work tab can open the worker's session as it opens the planning model's.
 * eve runs a node's hooks for that node's sessions alone, which is why the
 * worker has a hook of its own beside the root's. A hook's failure is
 * eve's to log and never reaches the worker's task.
 */

const relayState = defineState<RelayState>("luke.relay.child", () => EMPTY_RELAY_STATE);

export default defineHook({
  events: {
    "*"(event, ctx) {
      // Pinned before anything awaits, for the reason the root's relay pins it (`server/hosted/brain-host/pinned-state.ts`).
      const state = pinnedState(relayState);
      return relayChildEvent(event, ctx.session, state);
    },
  },
});
