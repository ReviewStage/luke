/**
 * skills.ts -- the agent skills a coding agent's session is offered: the ones its repository keeps, read where its checkout stands.
 *
 * The skills are the repository's (`../agent-runtime/skills.ts`). A coding
 * agent's checkout already holds each skill's sibling files, so its body is
 * led by the folder it stands in within the checkout.
 */

import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import type { Effect } from "effect";
import { agentMember, agentWorkspace } from "../../github/workspace-repository.js";
import { type AgentSkill, repositorySkills } from "../agent-runtime/skills.js";
import type { RepositorySkill } from "../repository-skills.js";
import { CODER } from "./bounds.js";
import type { CheckoutServices } from "./checkout.js";

/** The body a skill loads as: where it stands in the checkout, so its relative paths resolve, and then its own words. */
function loadedMarkdown(skill: RepositorySkill): string {
  const folder = `${CODER.CHECKOUT_PATH}/${skill.folder}`;
  return `This skill is \`${folder}/SKILL.md\` in the checkout; resolve the files it names relative to \`${folder}/\`.\n\n${skill.markdown}`;
}

/** The skills the agent's repository keeps on its default branch, as eve is handed them (`repositorySkills`). */
export function agentSkills(
  target: ConversationTarget,
  agent: CodingAgent,
): Effect.Effect<readonly AgentSkill[], never, CheckoutServices> {
  return repositorySkills(
    target,
    agentWorkspace(target.userId, agent),
    agent.repository,
    agentMember(agent),
    loadedMarkdown,
  );
}
