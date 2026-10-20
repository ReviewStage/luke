/**
 * issues-procedures.ts -- a workspace's issues, read and written by its members: list and file them, and read and change one.
 *
 * `GET /api/issues?workspaceId=` answers the workspace's issues, the most
 * recently changed first, or its archived ones where `archived=true`;
 * `POST` files one and answers it as kept. `GET /api/issues/:id` reads one
 * issue and `PATCH` changes it, archiving it among the rest, and answers it
 * as kept, so the window draws the service's word rather than its own
 * guess. Every request resolves the bearer before it touches a row or reads
 * its input, and the store gates every row on the account's membership of
 * the issue's workspace, so a workspace the account is not in, or an issue
 * of one, answers exactly as one that does not exist.
 */

import { changeIssue, createIssue, listIssues, readIssue } from "@luke/database/models/issue-store";
import { wireUuidSchema } from "@luke/features";
import { ISSUE_ARCHIVED_QUERY } from "@luke/features/contract";
import { ISSUE_BOUNDS } from "@luke/features/issue-wire";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result } from "effect";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, bodyLimit, hosted } from "../orpc/base.js";

/**
 * A body past this is no issue: the description's and the title's bounds
 * at six bytes a character, the most JSON spends on one (`\u0000`), and the
 * rest of the frame with room, so every issue the schema takes fits.
 */
const MAXIMUM_BODY_BYTES =
  (ISSUE_BOUNDS.MAX_DESCRIPTION_CHARS + ISSUE_BOUNDS.MAX_TITLE_CHARS) * 6 + 4_096;

export interface IssuesProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The issue the path's id names; one that is no UUID names no issue. */
function issueIdOf(id: string): Effect.Effect<string, HostedRefusal> {
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  return Result.isFailure(read)
    ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND)
    : Effect.succeed(read.success);
}

/** The issues resource: the list, a filing, and one issue's read and change, to a signed-in member. */
export function issuesProcedures(seams: IssuesProcedureSeams) {
  const issues = hosted.issues
    .use(accountMiddleware(seams.resolveUserId))
    .use(bodyLimit(MAXIMUM_BODY_BYTES));
  return {
    list: issues.list.effect(function* ({ input, context }) {
      const listed = yield* hostedStoreOrUnavailable(
        listIssues(context.userId, input.workspaceId, {
          archived: input.archived === ISSUE_ARCHIVED_QUERY.TRUE,
        }),
      );
      if (Option.isNone(listed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { issues: listed.value };
    }),
    create: issues.create.effect(function* ({ input, context }) {
      const { workspaceId, ...made } = input;
      const created = yield* hostedStoreOrUnavailable(
        createIssue(context.userId, { ...made, organizationId: workspaceId }),
      );
      if (Option.isNone(created)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      yield* recordServerEvent(SERVER_EVENT.ISSUE_CREATE, context.userId, {});
      return { issue: created.value };
    }),
    read: issues.read.effect(function* ({ input, context }) {
      const id = yield* issueIdOf(input.id);
      const issue = yield* hostedStoreOrUnavailable(readIssue(context.userId, id));
      if (Option.isNone(issue)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { issue: issue.value };
    }),
    change: issues.change.effect(function* ({ input, context }) {
      const id = yield* issueIdOf(input.params.id);
      const changed = yield* hostedStoreOrUnavailable(changeIssue(context.userId, id, input.body));
      if (Option.isNone(changed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { issue: changed.value };
    }),
  };
}
