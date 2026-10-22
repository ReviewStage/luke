import { offeredSkills, skillsOpenSandbox } from "@luke/service/agents/agent-runtime/skills";
import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { SCRIPTED_SKILLS } from "@luke/service/testing/coder-scripted-model";
import { defineDynamic } from "eve/skills";
import { recordSandboxOpened, seams, sessionSkills } from "../host.js";
import { sandboxRecord } from "../session-prompt.js";

/**
 * The skills the agent's repository keeps, then the ones its member
 * installed into Luke, offered to the session as it starts and standing for
 * its life (`packages/service/src/agents/coder-host/skills.ts`), each under
 * its own name, which is what a developer's `/name` names and `load_skill`
 * loads; an installed skill's supporting files eve writes into the sandbox,
 * which it opens to do so, so the sandbox is recorded as opened then, as a
 * tool call that opens it is.
 * This is the role's one skill resolver, since two that hand eve one name
 * make it throw. A session that runs for a long time keeps the skills its
 * repository and its member held when it began. Under the scripted fixture the session
 * is offered the fixture's own skills, so the eval reaches no GitHub.
 */
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      // Pinned before anything awaits, as the store hook pins it (`hooks/store.ts`).
      const sandbox = pinnedState(sandboxRecord);
      const skills = seams.scriptedModel()
        ? SCRIPTED_SKILLS
        : await sessionSkills(ctx.session.auth, ctx.session.id);
      // eve opens the sandbox to write the skills' files as it takes them, which no tool call
      // records, so it is recorded here, for the store hook to stop at the turn's end.
      if (skillsOpenSandbox(skills)) {
        await recordSandboxOpened(sandbox, ctx.session.auth, ctx.session.id);
      }
      return offeredSkills(skills);
    },
  },
});
