/**
 * skills.ts -- the agent skills a coding agent's session is offered: its repository's, read where its checkout stands, then the ones its member installed.
 *
 * The skills are merged in `../agent-runtime/skills.ts`'s precedence: the
 * repository's, then the workspace's installed skills, then the member's
 * personal ones. A coding agent's checkout already holds each repository
 * skill's sibling files, so its body is led by the folder it stands in
 * within the checkout; an installed skill's files are written by eve into
 * the sandbox. An agent with no repository is offered its installed skills
 * alone. The member is the agent's starter, whose conversation it is, and
 * for an automation's agent the automation's owner, who starts it; the
 * workspace is its task's, read as that member, as its repository's reads
 * are.
 */

import { type CodingAgent, hasRepository } from "@luke/database/models/coding-agent-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { Effect } from "effect";
import { agentMember, agentWorkspace } from "../../github/workspace-repository.js";
import {
  type AgentSkill,
  installedSkills,
  mergedSkills,
  repositorySkills,
} from "../agent-runtime/skills.js";
import type { RepositorySkill } from "../repository-skills.js";
import { CODER } from "./bounds.js";
import type { CheckoutServices } from "./checkout.js";

/** The body a skill loads as: where it stands in the checkout, so its relative paths resolve, and then its own words. */
function loadedMarkdown(skill: RepositorySkill): string {
  const folder = `${CODER.CHECKOUT_PATH}/${skill.folder}`;
  return `This skill is \`${folder}/SKILL.md\` in the checkout; resolve the files it names relative to \`${folder}/\`.\n\n${skill.markdown}`;
}

/** The skills the agent's session is offered: its repository's on its default branch, where it has one, then its member's installed ones (`mergedSkills`). */
export function agentSkills(
  target: ConversationTarget,
  agent: CodingAgent,
): Effect.Effect<readonly AgentSkill[], never, CheckoutServices> {
  return Effect.gen(function* () {
    // The workspace is read once for both sources.
    const workspaceOf = yield* Effect.cached(agentWorkspace(target.userId, agent));
    const [repository, installed] = yield* Effect.all(
      [
        hasRepository(agent)
          ? repositorySkills(
              target,
              workspaceOf,
              agent.repository,
              agentMember(agent),
              loadedMarkdown,
            )
          : Effect.succeed([]),
        installedSkills(target, workspaceOf),
      ],
      { concurrency: "unbounded" },
    );
    return yield* mergedSkills(target, [repository, installed]);
  });
}
