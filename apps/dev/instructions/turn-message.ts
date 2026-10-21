/**
 * turn-message.ts -- what each turn opens with after the history: the call's words, the developer's time, and the task and chat where they changed.
 *
 * A user-role instruction, which eve appends to the session's durable
 * history as the turn starts, ahead of the turn's own message, rather than
 * a system one, which eve merges into the system message ahead of the
 * history: what this hands changes from turn to turn, and in the system
 * message it would have sent the agent's whole history again uncached on
 * every turn. Here the system prompt, the tools, and the history stay the
 * provider's cached prefix from one turn to the next, whatever kind of turn
 * each is. What the session has handed is kept in its state (`turnHanded`),
 * so a turn hands the call's words, the task, and the chat only where they
 * changed (`packages/service/src/agents/coder-host/turn-context.ts`).
 */

import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { defineDynamic, defineInstructions } from "eve/instructions";
import { readStepStarted, stepTurnId, turnMessage } from "../host.js";
import { turnHanded } from "../session-prompt.js";

export default defineDynamic({
  events: {
    "turn.started": async (event, ctx) => {
      // Pinned before anything awaits (`packages/service/src/agents/brain-host/pinned-state.ts`).
      const handed = pinnedState(turnHanded);
      const turnId = stepTurnId(ctx.session.id, readStepStarted(event));
      const message = await turnMessage(ctx.session.auth, ctx.session.id, turnId, handed.get());
      handed.update(() => message.handed);
      return message.text === undefined
        ? null
        : defineInstructions({ content: message.text, role: "user" });
    },
  },
});
