import { listPages, readPageVersion } from "@repo/database/models/task-pages";
import { PAGE_OWNER, pageVersionNumberSchema } from "@repo/features/page-wire";
import { unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Option, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { pageFrameAnswer } from "../pages/page-frame.js";

export interface AgentPagesProcedureSeams {
  resolveUserId: UserIdResolver;
}

function pageVersionOf(version: string): Effect.Effect<number, HostedRefusal> {
  const read = readEither(pageVersionNumberSchema)(unparsedWire(Number(version)));
  return Result.isFailure(read)
    ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
    : Effect.succeed(read.success);
}

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
    frame: member.frame.effect(function* ({ input, context }) {
      const agentId = yield* pathUuid(input.id);
      const pageId = yield* pathUuid(input.page);
      const version = yield* pageVersionOf(input.version);
      const owner = { kind: PAGE_OWNER.AGENT, agentId } as const;
      return yield* pageFrameAnswer(context.request, context.userId, owner, pageId, version);
    }),
  };
}
