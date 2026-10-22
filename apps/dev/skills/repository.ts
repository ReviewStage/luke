import { offeredSkills } from "@luke/service/agents/agent-runtime/skills";
import { SCRIPTED_SKILLS } from "@luke/service/testing/coder-scripted-model";
import { defineDynamic } from "eve/skills";
import { seams, sessionSkills } from "../host.js";

/**
 * The skills the agent's repository keeps, then the ones its member
 * installed into Luke, offered to the session as it starts and standing for
 * its life (`packages/service/src/agents/coder-host/skills.ts`), each under
 * its own name, which is what a developer's `/name` names and `load_skill`
 * loads; an installed skill's supporting files eve writes into the sandbox.
 * This is the role's one skill resolver, since two that hand eve one name
 * make it throw. A session that runs for a long time keeps the skills its
 * repository and its member held when it began. Under the scripted fixture the session
 * is offered the fixture's own skills, so the eval reaches no GitHub.
 */
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) =>
      offeredSkills(
        seams.scriptedModel()
          ? SCRIPTED_SKILLS
          : await sessionSkills(ctx.session.auth, ctx.session.id),
      ),
  },
});
