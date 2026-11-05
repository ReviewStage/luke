/**
 * agent-repositories.ts -- the repositories an agent works in, its primary first, read as one list.
 *
 * An agent's primary repository is its own row's (`agent.repository`, its
 * start branch, its branch, and its pull request), and the repositories it
 * works in beside it are `agent_repository`'s rows, by position. Every
 * reader that must see an agent's extras reads them here, in that order,
 * and none reads the extras' table by itself: the token minted for the set,
 * the checkout, and the instructions. An agent with no repository has none,
 * since a Start names extras only beside a primary. The read is made as the
 * account the agent works for, as the agent reads itself (`agentReachableBy`),
 * so an account reads none of another's agent.
 */

import { and, asc, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { agentTable, type StoredPullRequest } from "../schemas/agent.js";
import { agentRepository } from "../schemas/agent-repository.js";
import { type AgentStoreEffect, PublishedColumnSchema } from "./agent-store.js";
import { agentReachableBy } from "./workspace-store.js";

/** One repository an agent works in: `owner/name`, the branch its checkout is cloned at and its pull request opens against, its pull request's head, and that pull request as GitHub last answered. */
export interface AgentRepositoryEntry {
  readonly repository: string;
  /** None for the repository's default branch. */
  readonly baseBranch: string | null;
  /** None until a pull request opens. */
  readonly headBranch: string | null;
  /** None before a read found one. */
  readonly pullRequest: StoredPullRequest | null;
}

const AgentRepositoryRowSchema = Schema.Struct({
  repository: Schema.NullOr(Schema.String),
  baseBranch: Schema.NullOr(Schema.String),
  headBranch: Schema.NullOr(Schema.String),
  pullRequest: Schema.NullOr(PublishedColumnSchema),
  extraPosition: Schema.NullOr(Schema.Number),
  extraRepository: Schema.NullOr(Schema.String),
  extraBaseBranch: Schema.NullOr(Schema.String),
  extraHeadBranch: Schema.NullOr(Schema.String),
  extraPullRequest: Schema.NullOr(PublishedColumnSchema),
});

/** The agent's row with each of its extras beside it, in their order: one row with no extra where it has none. */
const findAgentRepositories = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: AgentRepositoryRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          repository: agentTable.repository,
          baseBranch: agentTable.startBranch,
          headBranch: agentTable.branch,
          pullRequest: agentTable.published,
          extraPosition: agentRepository.position,
          extraRepository: agentRepository.repository,
          extraBaseBranch: agentRepository.baseBranch,
          extraHeadBranch: agentRepository.headBranch,
          extraPullRequest: agentRepository.published,
        })
        .from(agentTable)
        .leftJoin(agentRepository, eq(agentRepository.agentId, agentTable.id))
        .where(and(eq(agentTable.id, agentId), agentReachableBy(userId)))
        .orderBy(asc(agentRepository.position)),
    ),
});

/**
 * The repositories the agent works in, as the account reaches the agent:
 * its primary, from its own row, then its extras by position; none for an
 * agent with no repository, and none where the account does not reach the
 * agent.
 */
export function readAgentRepositories(
  userId: string,
  agentId: string,
): AgentStoreEffect<readonly AgentRepositoryEntry[]> {
  return Effect.map(findAgentRepositories({ userId, agentId }), (rows) => {
    const [first] = rows;
    if (first === undefined || first.repository === null) return [];
    const primary: AgentRepositoryEntry = {
      repository: first.repository,
      baseBranch: first.baseBranch,
      headBranch: first.headBranch,
      pullRequest: first.pullRequest,
    };
    const extras = rows.flatMap((row): AgentRepositoryEntry[] =>
      row.extraRepository === null
        ? []
        : [
            {
              repository: row.extraRepository,
              baseBranch: row.extraBaseBranch,
              headBranch: row.extraHeadBranch,
              pullRequest: row.extraPullRequest,
            },
          ],
    );
    return [primary, ...extras];
  });
}
