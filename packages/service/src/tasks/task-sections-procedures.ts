import { listTaskSections, writeTaskSections } from "@repo/database/models/task-section-store";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted, writeReceiptMiddleware } from "../orpc/base.js";

export interface TaskSectionsProcedureSeams {
  resolveUserId: UserIdResolver;
}

export function taskSectionsProcedures(seams: TaskSectionsProcedureSeams) {
  const sections = hosted.taskSections.use(accountMiddleware(seams.resolveUserId));
  return {
    list: sections.list.effect(function* ({ context }) {
      return yield* hostedStoreOrUnavailable(listTaskSections(context.userId));
    }),
    write: sections.write.use(writeReceiptMiddleware).effect(function* ({ input, context }) {
      const written = yield* hostedStoreOrUnavailable(writeTaskSections(context.userId, input));
      if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      return written.value;
    }),
  };
}
