/**
 * agent-transcript-live.ts -- a coding agent's transcript as the desktop follows it over Neon Realtime, declared once (`live-read.ts`).
 */

import { Schema as EffectSchema } from "effect";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  liveRead,
  liveRows,
  ORDER,
} from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";
import { transcriptWindowPartRowSchema, transcriptWindowRowSchema } from "./transcript-window.js";

/**
 * A coding agent's transcript, or one of its workers', declared
 * by the agent, `?id=`, and the delegation call of the worker, `&call=`,
 * where it is a worker's (`agentTranscript`): the statements a page past the reader's
 * cursor is read from, which move where the service's held read would wake
 * (`packages/service/src/agents/coder-host/transcript-live.ts`): its
 * messages, its turns, its conversation's journal revision and title, the
 * agent's title, its workers' titles and delegations, its queue, and a
 * device agent's newest launch line; and its newest
 * messages themselves as rows (`window`, `windowParts`), which the reader
 * draws as they arrive; to a reader that names a cursor, only those written
 * or amended past it, which it joins by message id onto the ones it holds.
 * What stands beside them on a page, the agent's
 * status, cost, workers, and where its launch stands, is still read from
 * the service, once the turns, titles, workers, queue, or launch move. The service answers
 * `not-found` for an agent the account does not reach, and `unavailable`
 * where its deployment's Realtime is misconfigured, which the desktop
 * answers by asking again.
 */
export const AGENT_TRANSCRIPT_READ = liveRead({
  name: "agentTranscript",
  path: HOSTED_SERVICE_PATH.LIVE_AGENT_TRANSCRIPT,
  params: {
    id: LIVE_PARAM.TEXT,
    call: LIVE_PARAM.OPTIONAL_TEXT,
    [LIVE_USER_QUERY]: LIVE_PARAM.USER,
    ownerId: LIVE_PARAM.SERVED,
    conversationId: LIVE_PARAM.SERVED,
    parentConversationId: LIVE_PARAM.SERVED,
    agentId: LIVE_PARAM.SERVED,
  },
  mode: LIVE_MODE.CURSOR,
  parts: {
    /** How many messages the transcript holds and its newest: still sealed for released desktops, which read a page again as it moves; the host follows the window's rows instead, and keeps none of it. */
    messages: liveRows({
      row: EffectSchema.Struct({ rows: countedNumber, seq: countedNumber }),
      key: "seq",
      order: [["seq", ORDER.ASC]],
      optional: true,
    }),
    turns: liveRows({
      row: EffectSchema.Struct({
        status: EffectSchema.String,
        rows: countedNumber,
        stopped: countedNumber,
        changedAt: countedNumber,
      }),
      key: "status",
      order: [["status", ORDER.ASC]],
    }),
    conversation: liveRows({
      row: EffectSchema.Struct({
        id: EffectSchema.String,
        title: EffectSchema.NullOr(EffectSchema.String),
        revision: countedNumber,
      }),
      key: "id",
      order: [["id", ORDER.ASC]],
    }),
    agent: liveRows({
      row: EffectSchema.Struct({
        id: EffectSchema.String,
        title: EffectSchema.NullOr(EffectSchema.String),
      }),
      key: "id",
      order: [["id", ORDER.ASC]],
    }),
    workers: liveRows({
      row: EffectSchema.Struct({
        id: EffectSchema.String,
        title: EffectSchema.NullOr(EffectSchema.String),
        callId: EffectSchema.NullOr(EffectSchema.String),
      }),
      key: "id",
      order: [["id", ORDER.ASC]],
    }),
    window: liveRows({
      row: transcriptWindowRowSchema,
      key: "id",
      order: [["seq", ORDER.DESC]],
    }),
    windowParts: liveRows({
      row: transcriptWindowPartRowSchema,
      key: "messageId",
      order: [
        ["messageId", ORDER.ASC],
        ["index", ORDER.ASC],
      ],
    }),
    /** The agent's queue as its revision, a row at most, none before its first change; absent from a service older than the queue. */
    queueRevision: liveRows({
      row: EffectSchema.Struct({ revision: countedNumber }),
      key: "revision",
      order: [["revision", ORDER.ASC]],
      optional: true,
    }),
    /** A device agent's newest launch line, a row at most: its id, the step its host reported, and whether it is claimed and settled; none for an agent in the cloud and on a worker's transcript, and absent from a service older than it. */
    launch: liveRows({
      row: EffectSchema.Struct({
        id: EffectSchema.String,
        step: EffectSchema.NullOr(EffectSchema.String),
        claimed: EffectSchema.Boolean,
        settled: EffectSchema.Boolean,
      }),
      key: "id",
      order: [["id", ORDER.ASC]],
      optional: true,
    }),
  },
  /** A desktop that follows the window's own rows drops the count of its messages (`transcript-follow.ts`'s `followedRead`), so the digest it sends is over these alone. */
  olderParts: ["turns", "conversation", "agent", "workers", "queueRevision", "launch"],
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

export type AgentTranscriptLiveAnswer = LiveReadAnswer<typeof AGENT_TRANSCRIPT_READ>;

/** A transcript's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export type AgentTranscriptLiveRows = typeof AGENT_TRANSCRIPT_READ.rows.Type;
