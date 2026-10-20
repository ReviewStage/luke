/**
 * task-sections-procedures.ts -- the sections the account made in the Mac's sidebars and the tasks it keeps in them: read them, and write one change.
 *
 * `GET /api/task-sections` answers the account's sections and its entries;
 * `PUT` makes, edits, moves, or deletes one section, or puts one task in a
 * section or in none, and answers them all as they then stand, so the
 * window draws the service's word rather than its own guess. Every request
 * resolves the bearer before it touches a row, and every row it touches is
 * the bearer's account's own (`task-section-store.ts`). It stands apart
 * from `/api/plans/*` because that path's rewrite reads its next segment
 * as a plan's id.
 */

import { listTaskSections, writeTaskSections } from "@luke/database/models/task-section-store";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, bodyLimit, hosted } from "../orpc/base.js";

/** A write is two ids, a title, and an emoji at most, so a body past this is not one. */
const MAXIMUM_WRITE_BODY_BYTES = 2_048;

export interface TaskSectionsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The sections resource: the account's sections, and one change written to them. */
export function taskSectionsProcedures(seams: TaskSectionsProcedureSeams) {
  const sections = hosted.taskSections
    .use(accountMiddleware(seams.resolveUserId))
    .use(bodyLimit(MAXIMUM_WRITE_BODY_BYTES));
  return {
    list: sections.list.effect(function* ({ context }) {
      return yield* hostedStoreOrUnavailable(listTaskSections(context.userId));
    }),
    write: sections.write.effect(function* ({ input, context }) {
      const written = yield* hostedStoreOrUnavailable(writeTaskSections(context.userId, input));
      // A section that is not the account's, a task it does not reach there, or one past the bound is a request the service will not keep.
      if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      return written.value;
    }),
  };
}
