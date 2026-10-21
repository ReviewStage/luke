/**
 * live.ts -- the reads the desktop follows over Neon Realtime (`live-wire.ts`), sealed for the caller's own account.
 *
 * What waits on the developer across the account, as the address to
 * subscribe at and one sealed statement per part of the account inbox's
 * answer; and one task's whiteboard, named by `?id=`, as the statement that
 * marks where it stands, and its pages and calls the same way; and one coding agent's transcript, or one of its
 * workers' under `&call=`, as the statements its pages are read from; and
 * the commands of the kinds `?kinds=` names that no Mac of the account has
 * claimed, as one statement. Each
 * asked with `?poll=true` answers each statement's rows inline instead, for
 * a reader polling while Realtime fails or is off; with `&after=` too, the
 * poll is held until the rows move past it, or answered unchanged. Each
 * names the account it was started for under `?userId=`, and a session of
 * any other is answered as signed out. Each output is the wire schema flipped
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
  macCommandsLiveAnswerSchema,
  taskBoardLiveAnswerSchema,
  taskRecordLiveAnswerSchema,
} from "../live-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { hostedProcedure } from "./base.js";

/** Whether the reader asks for the rows inline, polling while Realtime fails it (`LIVE_POLL`). */
const pollField = EffectSchema.optionalKey(EffectSchema.Literal(LIVE_POLL.ON));

/** Where the rows stood when the reader last polled (`liveDigestOf`); the poll is held until they move past it. */
const afterField = EffectSchema.optionalKey(EffectSchema.String);

/** The account the reader started following for, which the session must be (`LIVE_USER_QUERY`). */
const userField = EffectSchema.optionalKey(EffectSchema.String);

/** A live read's own query: whether it polls. */
const liveReadSchema = EffectSchema.Struct({
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

/** The task a live read is followed for; one that is no UUID is answered as not found, so it is read as text here. */
const liveTaskSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

/** The agent a transcript is followed for, and the delegation call of the worker where it is a worker's; each read as text, an id or call of no shape answered as not found. */
const liveTranscriptSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  call: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

/** The kinds of command a Mac's live read follows, as its held read names them (`macCommandKindsQuery`). */
const liveMacCommandsSchema = EffectSchema.Struct({
  kinds: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
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
  taskRecord: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASK_RECORD }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(taskRecordLiveAnswerSchema)),
  agentTranscript: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AGENT_TRANSCRIPT }))
    .input(liveTranscriptSchema)
    .output(EffectSchema.flip(agentTranscriptLiveAnswerSchema)),
  macCommands: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_MAC_COMMANDS }))
    .input(liveMacCommandsSchema)
    .output(EffectSchema.flip(macCommandsLiveAnswerSchema)),
};
