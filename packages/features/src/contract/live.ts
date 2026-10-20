/**
 * live.ts -- the reads the desktop follows over Neon Realtime (`live-wire.ts`), sealed for the caller's own account.
 *
 * What waits on the developer across the account, as the address to
 * subscribe at and one sealed statement per part of the account inbox's
 * answer; and one task's whiteboard, named by `?id=`, as the statement that
 * marks where it stands. Either asked with `?poll=true` answers each
 * statement's rows inline instead, for a reader polling while Realtime
 * fails it. Each output is the wire schema flipped
 * (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  accountInboxLiveAnswerSchema,
  LIVE_POLL,
  taskBoardLiveAnswerSchema,
} from "../live-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { hostedProcedure } from "./base.js";

/** Whether the reader asks for the rows inline, polling while Realtime fails it (`LIVE_POLL`). */
const pollField = EffectSchema.optionalKey(EffectSchema.Literal(LIVE_POLL.ON));

/** A live read's own query: whether it polls. */
const liveReadSchema = EffectSchema.Struct({ [LIVE_POLL.QUERY]: pollField });

/** The task a live read is followed for; one that is no UUID is answered as not found, so it is read as text here. */
const liveTaskSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
});

export const liveContract = {
  inbox: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INBOX }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(accountInboxLiveAnswerSchema)),
  taskBoard: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASK_BOARD }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(taskBoardLiveAnswerSchema)),
};
