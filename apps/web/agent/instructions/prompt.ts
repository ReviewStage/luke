import { defineDynamic, defineInstructions } from "eve/instructions";
import { host } from "../host.js";
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
    "session.started": async (_event, ctx) => {
      const admitted = await host.admitStarting(ctx.session.auth, ctx.session.id);
      if (!admitted.ok) return null;
      const turn = host.turnKindOf(ctx.session.auth);
      if (!turn) return null;
      const prompt = await host.prompt(admitted, turn.trigger);
      sessionPrompt.update(() => ({ hash: prompt.hash }));
      return defineInstructions({ content: prompt.text });
    },
    "turn.started": async (_event, ctx) => {
      const admitted = await host.admit(ctx.session.auth, ctx.session.id);
      if (!admitted.ok) return null;
      return defineInstructions({ content: await host.standingContext(admitted) });
    },
  },
});
