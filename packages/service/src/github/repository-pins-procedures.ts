/**
 * repository-pins-procedures.ts -- the repositories the account pinned in the Mac's sidebar: read them, and pin or unpin one.
 *
 * `GET /api/repository-pins` answers the account's pins, newest pinned
 * first; `PUT` pins or unpins one repository and answers them all as they
 * then stand, so the window draws the service's word rather than its own
 * guess. A pin names a repository and nothing of it, so it asks GitHub
 * nothing: a repository the account no longer reaches simply groups no task.
 * Every request resolves the bearer before it touches a row, and every row
 * it touches is the bearer's account's own. It stands apart from
 * `/api/plans/*` because that path's rewrite reads its next segment as a
 * task's id.
 */

import { listRepositoryPins, setRepositoryPin } from "@luke/database/models/repository-pin-store";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

export interface RepositoryPinsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The pins resource: the account's pins, and one pinned or unpinned. */
export function repositoryPinsProcedures(seams: RepositoryPinsProcedureSeams) {
  const pins = hosted.repositoryPins.use(accountMiddleware(seams.resolveUserId));
  return {
    list: pins.list.effect(function* ({ context }) {
      return { pins: yield* hostedStoreOrUnavailable(listRepositoryPins(context.userId)) };
    }),
    set: pins.set.effect(function* ({ input, context }) {
      const set = yield* hostedStoreOrUnavailable(
        setRepositoryPin(context.userId, input.repository, input.pinned),
      );
      // A pin past the bound is a request the service will not keep, as a name past its bound is.
      if (Option.isNone(set)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      return { pins: set.value };
    }),
  };
}
