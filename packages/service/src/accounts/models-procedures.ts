import { failureKind } from "@repo/runtime/effect";
import { Effect } from "effect";
import {
  accountFastOffer,
  macOffers,
  markedUnconnected,
} from "../agents/coder-host/agent-runtime-choice.js";
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
      const fastOffer = yield* hostedStoreOrUnavailable(accountFastOffer(context.userId));
      const offered = offeredToAccount(models, fastOffer);
      const macs = yield* hostedStoreOrUnavailable(macOffers(context.userId));
      return {
        models: yield* hostedStoreOrUnavailable(markedUnconnected(context.userId, offered)),
        ...(macs.length > 0 ? { macs } : {}),
      };
    }),
  };
}
