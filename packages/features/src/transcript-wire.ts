import { LiveCloseReasonSchema, TRANSCRIPT_SPEAKER } from "@luke/live";
import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { planEditorSchema } from "./task-wire.js";

/**
 * transcript-wire.ts -- what was said on a task's voice calls with Luke, as the service keeps it and the Tasks tab reads it.
 *
 * The service keeps a call's words as timed fragments
 * (`voice_transcript_segments`) and answers them grouped the way the live
 * captions group them, by the one ledger both sides keep
 * (`@luke/live`'s `TranscriptLedger`), so a call that ends reads back in
 * the lines its captions drew. Each line is answered as an AI SDK
 * `UIMessage`: an id, a role, and its words as one text part. That is the
 * shape Luke's `messages` table keeps every conversation in and the shape
 * the Transcript tab's components draw, so a voice call reads back the way
 * any other conversation of Luke's does. A call is named by the store's id
 * for its session, the same id the voice window reports beside the live
 * call's lines, which is how the tab tells the stored copy of a call from
 * the live one. A call on which nothing was said is no call here. Nothing in
 * this read is the model's: it is the words alone, by whom, on which call,
 * and what the call's record says of the call itself where it says it: when
 * it ended and why, the seconds the Live API metered, and the model it ran
 * on. A call recorded before a field was, or still standing, answers
 * without it. The Live API meters a call by its seconds alone, so there are
 * no tokens to answer.
 */

export const TRANSCRIPT_BOUNDS = {
  /**
   * The most of the newest fragments one read gathers. A fragment is often a
   * few words, so this is a bound on the read rather than on the calls: past
   * it the oldest words are left out and the answer says so.
   */
  MAX_SEGMENTS: 4_000,
} as const;

/** The kinds of `UIMessage` part a spoken line is made of: its words, and nothing else. */
export const TRANSCRIPT_PART_TYPE = {
  TEXT: "text",
} as const;

/** The words of a line, as the one text part of its message. */
export const transcriptTextPartSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(TRANSCRIPT_PART_TYPE.TEXT),
  text: EffectSchema.String,
});

/**
 * One speaker's utterance on a call, its fragments run together as received,
 * as a `UIMessage`: the speaker is the role, and the words are one text
 * part. The id is the line's place on its call, counted from zero, and the
 * metadata says where on the call the line began and ended, which places a
 * turn no line asked for among the lines by time, and names the line's rows
 * in the task's conversation, by the ids the
 * live call names its lines by and a brain turn names its ask by, where
 * the record holds them: one as a rule, and more where a call that
 * reattached wrote one utterance as two rows the line reads as one. Note that the parts are a mutable array, as the
 * SDK's type spells them, so a message read here is one of its messages
 * without a copy.
 */
export const transcriptMessageSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  role: EffectSchema.Literals(Object.values(TRANSCRIPT_SPEAKER)),
  parts: EffectSchema.mutable(EffectSchema.Array(transcriptTextPartSchema)),
  /** Absent from a service older than it. */
  metadata: EffectSchema.optionalKey(
    EffectSchema.Struct({
      /** Absent for a line whose rows the record does not hold. */
      rowIds: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
      /** Milliseconds into the call the line's words began and ended, as the live call's lines carry them; absent from a service older than it. */
      span: EffectSchema.optionalKey(
        EffectSchema.Struct({ startMs: countedNumber, endMs: countedNumber }),
      ),
    }),
  ),
});

export type TranscriptMessage = typeof transcriptMessageSchema.Type;

/**
 * One call about the task: the store's id for its session, when it started,
 * its messages in the order they opened, and what its record says of the
 * call where it says it.
 */
export const transcriptCallSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  /** Epoch milliseconds the call started. */
  startedAt: countedNumber,
  messages: EffectSchema.Array(transcriptMessageSchema),
  /** Epoch milliseconds the call ended; absent while it stands, or where no close was recorded. */
  endedAt: EffectSchema.optionalKey(countedNumber),
  /** Why the call ended, as the Live API's `session.closed` named it or the sweep that closed it decided. */
  ending: EffectSchema.optionalKey(LiveCloseReasonSchema),
  /**
   * The seconds the Live API metered the call for: `confirmed` where its
   * close counted them, otherwise the last count it reported while the call
   * stood.
   */
  usage: EffectSchema.optionalKey(
    EffectSchema.Struct({ seconds: countedNumber, confirmed: EffectSchema.Boolean }),
  ),
  /** The voice model the call ran on. */
  model: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * The member whose call it was, by their account's id and the name it
   * holds now, a member who has since left the workspace among them; absent
   * once their account is gone, and from a service before it. A shared
   * task's transcript holds every member's calls, and the window names a
   * teammate's while drawing the reader's own as theirs.
   */
  by: EffectSchema.optionalKey(planEditorSchema),
});

export type TranscriptCall = typeof transcriptCallSchema.Type;

/** A task's transcript: its calls oldest first, and whether older words were left out of the read. */
export const taskTranscriptSchema = EffectSchema.Struct({
  calls: EffectSchema.Array(transcriptCallSchema),
  earlierOmitted: EffectSchema.Boolean,
});

export type TaskTranscript = typeof taskTranscriptSchema.Type;

/** A transcript read (GET). */
export const taskTranscriptAnswerSchema = EffectSchema.Struct({ transcript: taskTranscriptSchema });

/** The transcript of a task no call has been made about. */
export const EMPTY_TRANSCRIPT: TaskTranscript = { calls: [], earlierOmitted: false };
