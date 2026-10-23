/**
 * agent-pages-procedures.ts -- the pages a coding agent on no task showed on itself, as the hosted oRPC router answers them.
 *
 * `GET /api/agents/{id}/pages` is the agent's own pages, each by its newest
 * version, and `/api/agents/{id}/pages/{page}/versions/{version}` one
 * version's HTML, answered inside JSON so no page is ever a document of this
 * origin (`@luke/database/models/plan-pages`). Each reads as the task's own
 * pages read under the task (`../tasks/task-files-procedures.ts`), gated on
 * the agent's rule of who may read it rather than a task's: an agent the
 * account does not reach lists no pages and answers a version as not found,
 * exactly as one that names nothing, and an id that is no UUID names none.
 */

import { listPages, readPageVersion } from "@luke/database/models/plan-pages";
import { PAGE_OWNER, pageVersionNumberSchema } from "@luke/features/page-wire";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

export interface AgentPagesProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The version a path names, or the invalid-request refusal where it is no whole number from one. */
function pageVersionOf(version: string): Effect.Effect<number, HostedRefusal> {
  const read = readEither(pageVersionNumberSchema)(unparsedWire(Number(version)));
  return Result.isFailure(read)
    ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
    : Effect.succeed(read.success);
}

/** The agent pages resource: the list and one version, to a signed-in caller resolved before its input is read. */
export function agentPagesProcedures(seams: AgentPagesProcedureSeams) {
  const member = hosted.agentPages.use(accountMiddleware(seams.resolveUserId));
  return {
    list: member.list.effect(function* ({ input, context }) {
      const agentId = yield* pathUuid(input.id);
      const owner = { kind: PAGE_OWNER.AGENT, agentId } as const;
      return { pages: yield* hostedStoreOrUnavailable(listPages(context.userId, owner)) };
    }),
    version: member.version.effect(function* ({ input, context }) {
      const agentId = yield* pathUuid(input.id);
      const pageId = yield* pathUuid(input.page);
      const version = yield* pageVersionOf(input.version);
      const owner = { kind: PAGE_OWNER.AGENT, agentId } as const;
      const page = yield* hostedStoreOrUnavailable(
        readPageVersion(context.userId, owner, pageId, version),
      );
      if (Option.isNone(page)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { page: page.value };
    }),
  };
}
