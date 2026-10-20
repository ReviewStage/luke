/**
 * factory-world-procedures.ts -- a workspace's Factory world, read whole for a member of it.
 *
 * `POST /api/factory/world` takes `{ workspaceId }` and answers
 * `{ world }`, the world composed as it stands now (`factory-world.ts`), or
 * null where the workspace reaches no repository to draw. A workspace the
 * account is not in is not found; a GitHub or a store the service could not
 * reach is unavailable. Nothing is written.
 */

import { workspaceOf } from "@luke/database/models/workspace-store";
import { Effect, Option } from "effect";
import { githubReadOrRefusal } from "../github/github-refusal.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, bodyLimit, hosted } from "../orpc/base.js";
import { readFactoryWorld } from "./factory-world.js";

/** The most a request body may hold: a workspace id. */
const MAXIMUM_BODY_BYTES = 1_024;

export interface FactoryProcedureSeams {
  readonly resolveUserId: UserIdResolver;
}

/** The factory resource: the workspace's world, to any member of it. */
export function factoryProcedures(seams: FactoryProcedureSeams) {
  const factory = hosted.factory
    .use(accountMiddleware(seams.resolveUserId))
    .use(bodyLimit(MAXIMUM_BODY_BYTES));
  return {
    world: factory.world.effect(function* ({ input, context }) {
      const workspace = yield* hostedStoreOrUnavailable(
        workspaceOf(context.userId, input.workspaceId),
      );
      if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const world = yield* githubReadOrRefusal(
        readFactoryWorld(context.userId, workspace.value.id),
      );
      return { world: Option.getOrNull(world) };
    }),
  };
}
