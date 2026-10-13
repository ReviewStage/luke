import { defineDynamic, defineSkill } from "eve/skills";
import type { CoderSkill } from "../../server/hosted/coder-host/skills.js";
import { seams, sessionSkills } from "../host.js";
import { SCRIPTED_SKILLS } from "../scripted-model.js";

/** The skills as eve's map of them, by name; nothing where there are none. */
function offered(skills: readonly CoderSkill[]) {
  if (skills.length === 0) return null;
  return Object.fromEntries(
    skills.map((skill) => [
      skill.name,
      defineSkill({ description: skill.description, markdown: skill.markdown }),
    ]),
  );
}

/**
 * The skills the agent's repository keeps, offered to the session as it
 * starts and standing for its life (`server/hosted/coder-host/skills.ts`),
 * each under its own name, which is what a developer's `/name` names and
 * `load_skill` loads. A session that runs for a long time keeps the skills
 * its repository held when it began. Under the scripted fixture the session
 * is offered the fixture's own skills, so the eval reaches no GitHub.
 */
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) =>
      offered(
        seams.scriptedModel()
          ? SCRIPTED_SKILLS
          : await sessionSkills(ctx.session.auth, ctx.session.id),
      ),
  },
});
