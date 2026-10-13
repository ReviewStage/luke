/**
 * skills.ts -- the agent skills a coding agent's session is offered: the ones its repository keeps.
 *
 * eve offers a session the skills its resolvers hand it, lists each by its
 * description, and loads one's body with `load_skill` when the developer
 * names it or the work matches it; it never looks in the checkout for
 * skills of its own. So the repository's skills are read from GitHub as the
 * session starts (`../repository-skills.ts`), on a read token for the
 * agent's one repository, and handed to eve as skills of the session. A
 * skill's body is handed as markdown alone, so eve writes nothing into the
 * sandbox and opens none for it: the skill's sibling files already stand in
 * the checkout, at the folder the body is prefixed with. Read as the
 * session starts, so a read that fails is logged and offers no skills
 * rather than failing the start.
 */

import type { CodingAgent } from "@sidecar/database/models/coding-agent-store";
import type { ConversationTarget } from "@sidecar/database/models/writer";
import { Effect, Option } from "effect";
import { GitHubApp } from "../../github/github-app.js";
import { type RepositorySkill, readRepositorySkills } from "../repository-skills.js";
import { CODER } from "./bounds.js";
import type { CheckoutServices } from "./checkout.js";

/** One skill as eve is handed it: its name, the description it routes on, and the body `load_skill` answers. */
export interface CoderSkill {
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
}

/** The body a skill loads as: where it stands in the checkout, so its relative paths resolve, and then its own words. */
function loadedMarkdown(skill: RepositorySkill): string {
  const folder = `${CODER.CHECKOUT_PATH}/${skill.folder}`;
  return `This skill is \`${folder}/SKILL.md\` in the checkout; resolve the files it names relative to \`${folder}/\`.\n\n${skill.markdown}`;
}

/**
 * The skills the agent's repository keeps on its default branch, as eve is
 * handed them; none where the App does not reach the repository or GitHub
 * could not be read, which is logged.
 */
export const agentSkills = /* @__PURE__ */ Effect.fn("web/agentSkills")(function* (
  target: ConversationTarget,
  agent: CodingAgent,
): Effect.fn.Return<readonly CoderSkill[], never, CheckoutServices> {
  const app = yield* GitHubApp;
  const read = Effect.gen(function* () {
    const reached = yield* app.repositoryReadToken(target.userId, agent.repository);
    if (Option.isNone(reached)) return [];
    return yield* readRepositorySkills(reached.value.token, reached.value.repository);
  });
  const skills = yield* read.pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `The skills of conversation ${target.conversationId} were not read: ${failure._tag}`,
        ),
        [],
      ),
    ),
  );
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    markdown: loadedMarkdown(skill),
  }));
});
