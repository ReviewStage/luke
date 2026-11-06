/**
 * agent-origin.ts -- the run of an automation that started one coding agent, bound: its one statement, the tables it reads, the topics that wake it, and who it admits.
 *
 * The statement reads what the agent's page reads of its origin
 * (`status.ts`'s `agentPage`): the run as the agent's row kept it, and the
 * name of the member who asked for a run now as their account names them
 * now, under the agent's own rule of who may read it (`agentVisibleTo`), so
 * an agent the account does not reach, or one no run started, is no rows.
 * It reads no clock, as Realtime requires.
 *
 * It is woken by the agent's own row, which nothing moves the run on once
 * the agent is made, and by what admits the reader to it. Note that a
 * runner's own name wakes no origin, as the history's editor's wakes no
 * history: a rename shows at the hold's end.
 */

import { queryBuilder } from "@repo/database/core/query";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import { agentVisibleTo } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  taskSync,
  userSync,
} from "@repo/database/sync/tables";
import { AGENT_ORIGIN_READ } from "@repo/features/agent-origin-live";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

export const agentOriginRead = bindLiveRead(AGENT_ORIGIN_READ, {
  reads: [
    agentSync,
    userSync,
    taskSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, id }) => [
    [TOPIC.AGENT, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id }) => ({
    origin: liveRowsStatement(
      AGENT_ORIGIN_READ.parts.origin,
      {
        ordered: false,
        columns: {
          origin: sql<
            typeof AGENT_ORIGIN_READ.parts.origin.row.Encoded.origin
          >`${agentTable.automationOrigin}`,
          runnerName: sql<string | null>`${user.name}`,
        },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(agentTable)
          .leftJoin(user, eq(user.id, sql`${agentTable.automationOrigin} -> 'firing' ->> 'userId'`))
          .where(
            and(
              eq(agentTable.id, id),
              isNotNull(agentTable.automationOrigin),
              agentVisibleTo(userId),
            ),
          ),
    ),
  }),
  admit: ({ userId, id }) =>
    Effect.flatMap(hostedStoreOrUnavailable(readVisibleAgent(userId, id)), (agent) =>
      Option.isNone(agent) ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.void,
    ),
});
