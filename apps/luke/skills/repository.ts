import { offeredSkills } from "@luke/service/agents/agent-runtime/skills";
import { defineDynamic } from "eve/skills";
import { seams, sessionSkills } from "../host.js";

/**
 * The skills the task's repository keeps, offered to the brain's session as
 * it starts and standing for its life (`packages/service/src/agents/agent-runtime/skills.ts`),
 * each under its own name, which `load_skill` loads when the developer names
 * one or the work matches it. The session starts on the call's opening ask,
 * the voice's warm-up (`packages/service/src/voice/live-brain.ts`), so the read is done
 * before the developer's first question. Under the scripted fixture the
 * session is offered none, so the eval reaches no GitHub.
 */
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) =>
      seams.scriptedModel()
        ? null
        : offeredSkills(await sessionSkills(ctx.session.auth, ctx.session.id)),
  },
});
