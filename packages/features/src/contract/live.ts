/**
 * live.ts -- the reads the desktop follows over Neon Realtime (`live-wire.ts`), sealed for the caller's own account.
 *
 * What waits on the developer across the account, as the address to
 * subscribe at and one sealed statement per part of the account inbox's
 * answer; the task list, as its tasks and every agent of them and with no
 * task; and one task's whiteboard, named by `?id=`, as the statement that
 * marks where it stands; and one coding agent's transcript, or one of its
 * workers' under `&call=`, as the statements its pages are read from. Each
 * asked with `?poll=true` answers each statement's rows inline instead, for
 * a reader polling while Realtime fails it. Each names the account it was
 * started for under `?userId=`, and a session of any other is answered as
 * signed out. Each output is the wire schema flipped
 * (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  accountInboxLiveAnswerSchema,
  agentTranscriptLiveAnswerSchema,
  LIVE_POLL,
  LIVE_USER_QUERY,
  taskBoardLiveAnswerSchema,
} from "../live-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { taskListLiveAnswerSchema } from "../task-list-live.js";
import { hostedProcedure } from "./base.js";

/** Whether the reader asks for the rows inline, polling while Realtime fails it (`LIVE_POLL`). */
const pollField = EffectSchema.optionalKey(EffectSchema.Literal(LIVE_POLL.ON));

/** The account the reader started following for, which the session must be (`LIVE_USER_QUERY`). */
const userField = EffectSchema.optionalKey(EffectSchema.String);

/** A live read's own query: whether it polls, and for whom. */
const liveReadSchema = EffectSchema.Struct({
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_USER_QUERY]: userField,
});

/** The task a live read is followed for; one that is no UUID is answered as not found, so it is read as text here. */
const liveTaskSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_USER_QUERY]: userField,
});

/** The agent a transcript is followed for, and the delegation call of the worker where it is a worker's; each read as text, an id or call of no shape answered as not found. */
const liveTranscriptSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  call: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_USER_QUERY]: userField,
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
  tasks: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASKS }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(taskListLiveAnswerSchema)),
  agentTranscript: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AGENT_TRANSCRIPT }))
    .input(liveTranscriptSchema)
    .output(EffectSchema.flip(agentTranscriptLiveAnswerSchema)),
};
