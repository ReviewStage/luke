import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { EMPTY_RELAY_STATE, type RelayState } from "@luke/service/agents/brain-host/relay";
import { defineState } from "eve/context";
import { defineHook } from "eve/hooks";
import { relayChildEvent } from "../../../host.js";
import { delegationRecord } from "../../../session-prompt.js";

/**
 * The relay from the worker's own stream into the store: every event eve
 * records for the worker's child session is told to the writer under the
 * child conversation of the agent's call that started it, so a tab can open
 * the worker's session as it opens the agent's. eve runs a node's hooks for
 * that node's sessions alone, which is why the worker has a hook of its own
 * beside the root's. The hook is also where the worker learns which call it
 * runs for: a hook is handed the session's lineage and the model resolver
 * none, so the call is pinned in the worker's state the first time any
 * event arrives, which is the session's start. A hook's failure is eve's
 * to log and never reaches the worker's task.
 */

const relayState = defineState<RelayState>("luke.coder.relay.child", () => EMPTY_RELAY_STATE);

export default defineHook({
  events: {
    "*"(event, ctx) {
      // Pinned before anything awaits, for the reason the root's relay pins it (`packages/service/src/agents/brain-host/pinned-state.ts`).
      const state = pinnedState(relayState);
      const delegation = pinnedState(delegationRecord);
      const parentCallId = ctx.session.parent?.callId;
      if (parentCallId !== undefined && delegation.get().parentCallId === undefined) {
        delegation.update(() => ({ parentCallId }));
      }
      return relayChildEvent(event, ctx.session, state);
    },
  },
});
