/**
 * models-procedures.ts -- the models a coding agent may run on, as the Start menu and Settings offer them.
 *
 * `GET /api/models` answers the instance's cached read of AI Gateway's
 * public catalog, filtered to what Luke offers (`packages/service/src/providers/model-catalog.ts`):
 * each model's id, name, provider, the efforts it lists, and its two
 * context windows where it offers a choice of them. The catalog is
 * public and the same for every account, but what an account is offered
 * of it is not quite: where Anthropic said the organization of the key the
 * account's agents run on, its own or Luke's, was never granted fast mode,
 * Anthropic's fast versions are withheld, each base model saying so. So the
 * caller is resolved first, and the read is answered to a signed-in
 * desktop alone. A catalog the instance cannot
 * read, or a store that cannot say which keys are the account's, is an
 * outage, answered as unavailable for the caller to ask again.
 */

import { failureKind } from "@luke/runtime/effect";
import { Effect } from "effect";
import { anthropicFastAccess } from "../agents/coder-host/account-keys.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { ModelCatalog, offeredToAccount } from "../providers/model-catalog.js";

export interface ModelsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The models resource: its one read, to a signed-in caller. */
export function modelsProcedures(seams: ModelsProcedureSeams) {
  return {
    list: hosted.models.list.use(accountMiddleware(seams.resolveUserId)).effect(function* ({
      context,
    }) {
      const catalog = yield* ModelCatalog;
      const models = yield* catalog.read.pipe(
        Effect.tapError((unavailable) =>
          Effect.logWarning(
            `the model catalog could not be read: ${failureKind(unavailable.cause)}`,
          ),
        ),
        Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
      );
      const fastAccess = yield* hostedStoreOrUnavailable(anthropicFastAccess(context.userId));
      return { models: offeredToAccount(models, fastAccess) };
    }),
  };
}
