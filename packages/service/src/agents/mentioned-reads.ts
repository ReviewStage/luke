import type { DatabaseServices } from "@luke/database/core/query";
import { listPublishedCodingAgents } from "@luke/database/models/coding-agent-store";
import { listPages, readPageVersion } from "@luke/database/models/plan-pages";
import type { PageVersion } from "@luke/features/page-wire";
import type { Plan } from "@luke/features/plan-wire";
import { Effect, Option } from "effect";
import type { StoreFailure } from "../http/store-failure.js";
import {
  type MentionedAgent,
  type MentionedReads,
  mentionedOfPlan,
  NO_MENTIONED_READS,
} from "./mentioned-context.js";

/**
 * mentioned-reads.ts -- the pages and coding agents a message mentions on its agent's own plan, read as the sender at the send, for `mentioned-context.ts` to hand.
 *
 * A page is read at its newest version, and an agent with what it
 * published, archived or not, through the same reads the plan's side panel
 * and tabs are drawn from, so the sender is handed nothing of the plan they
 * could not open themselves. Nothing is read where the words mention no
 * page and no agent of the plan, which is nearly every message.
 */

/** The newest version of each page named that the plan holds, by id. */
const readPages = (userId: string, planId: string, named: readonly string[]) =>
  Effect.gen(function* () {
    const found = new Map<string, PageVersion>();
    if (named.length === 0) return found;
    const lines = yield* listPages(userId, planId);
    for (const line of lines.filter((each) => named.includes(each.id))) {
      const version = yield* readPageVersion(userId, planId, line.id, line.version);
      if (Option.isSome(version)) found.set(line.id, version.value);
    }
    return found;
  });

/** Each agent named that stands on the plan, by id, with where its work stands on GitHub. */
const readAgents = (userId: string, planId: string, named: readonly string[]) =>
  Effect.gen(function* () {
    const found = new Map<string, MentionedAgent>();
    if (named.length === 0) return found;
    const standing = yield* listPublishedCodingAgents(userId, [planId], { includeArchived: true });
    for (const { agent, published } of standing) {
      if (!named.includes(agent.id)) continue;
      found.set(agent.id, {
        id: agent.id,
        name: agent.title ?? agent.model,
        repository: agent.repository,
        branch: agent.branch,
        pullRequest: published === null ? null : { number: published.number, url: published.url },
        archived: agent.archivedAt !== null,
      });
    }
    return found;
  });

/** What the words mention of the plan's pages and agents, read as `userId`; nothing read where there is no plan or they mention none. */
export function readMentioned(
  userId: string,
  words: string,
  plan: Plan | undefined,
): Effect.Effect<MentionedReads, StoreFailure, DatabaseServices> {
  if (plan === undefined) return Effect.succeed(NO_MENTIONED_READS);
  const named = mentionedOfPlan(words, plan);
  if (named.pages.length === 0 && named.agents.length === 0) {
    return Effect.succeed(NO_MENTIONED_READS);
  }
  return Effect.all({
    pages: readPages(userId, plan.id, named.pages),
    agents: readAgents(userId, plan.id, named.agents),
  });
}
