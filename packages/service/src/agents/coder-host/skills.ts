import { type Agent, hasRepository } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { Effect } from "effect";
import { agentMember, ownAgentWorkspace } from "../../github/workspace-repository.js";
import {
  type AgentSkill,
  installedSkills,
  mergedSkills,
  repositorySkills,
} from "../agent-runtime/skills.js";
import type { RepositorySkill } from "../repository-skills.js";
import { CODER } from "./bounds.js";
import type { CheckoutServices } from "./checkout.js";

function loadedMarkdown(skill: RepositorySkill): string {
  const folder = `${CODER.CHECKOUT_PATH}/${skill.folder}`;
  return `This skill is \`${folder}/SKILL.md\` in the checkout; resolve the files it names relative to \`${folder}/\`.\n\n${skill.markdown}`;
}

function sourcedSkills(
  target: ConversationTarget,
  agent: Agent,
  loaded: (skill: RepositorySkill) => string = loadedMarkdown,
): Effect.Effect<readonly [readonly AgentSkill[], readonly AgentSkill[]], never, CheckoutServices> {
  return Effect.gen(function* () {
    const workspaceOf = yield* Effect.cached(ownAgentWorkspace(target.userId, agent));
    return yield* Effect.all(
      [
        hasRepository(agent)
          ? repositorySkills(target, workspaceOf, agent.repository, agentMember(agent), loaded)
          : Effect.succeed([]),
        installedSkills(target, workspaceOf),
      ],
      { concurrency: "unbounded" },
    );
  });
}

export function nativeSkills(
  target: ConversationTarget,
  agent: Agent,
  roots: readonly string[],
): Effect.Effect<readonly AgentSkill[], never, CheckoutServices> {
  return Effect.gen(function* () {
    const seen = new Set<string>();
    const [repository, installed] = yield* sourcedSkills(target, agent, (skill) => {
      if (roots.some((root) => skill.folder.startsWith(`${root}/`))) seen.add(skill.name);
      return loadedMarkdown(skill);
    });
    const theirs = repository.filter((skill) => seen.has(skill.name));
    const merged = mergedSkills([theirs, installed]);
    return merged.filter((skill) => !seen.has(skill.name));
  });
}
