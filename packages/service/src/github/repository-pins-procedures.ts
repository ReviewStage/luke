import { listRepositoryPins, setRepositoryPin } from "@repo/database/models/repository-pin-store";
import { Effect, Option } from "effect";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted, writeReceiptMiddleware } from "../orpc/base.js";

export interface RepositoryPinsProcedureSeams {
  resolveUserId: UserIdResolver;
}

export function repositoryPinsProcedures(seams: RepositoryPinsProcedureSeams) {
  const pins = hosted.repositoryPins.use(accountMiddleware(seams.resolveUserId));
  return {
    list: pins.list.effect(function* ({ context }) {
      return { pins: yield* hostedStoreOrUnavailable(listRepositoryPins(context.userId)) };
    }),
    set: pins.set.use(writeReceiptMiddleware).effect(function* ({ input, context }) {
      const set = yield* hostedStoreOrUnavailable(
        setRepositoryPin(context.userId, input.repository, input.pinned),
      );
      if (Option.isNone(set)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      if (set.value.txid !== undefined) {
        yield* recordServerEvent(
          SERVER_EVENT.REPOSITORY_PIN,
          { userId: context.userId },
          {
            pinned: input.pinned,
          },
        );
      }
      return set.value;
    }),
  };
}
