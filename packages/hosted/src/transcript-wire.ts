import { TRANSCRIPT_SPEAKER } from "@sidecar/live";
import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * transcript-wire.ts -- what was said on a plan's voice calls with Luke, as the service keeps it and the Plans tab reads it.
 *
 * The service keeps a call's words as timed fragments
 * (`voice_transcript_segments`) and answers them grouped the way the live
 * captions group them, by the one ledger both sides keep
 * (`@sidecar/live`'s `TranscriptLedger`), so a call that ends reads back in
 * the lines its captions drew. Each line is answered as an AI SDK
 * `UIMessage`: an id, a role, and its words as one text part. That is the
 * shape Luke's `messages` table keeps every conversation in and the shape
 * the Transcript tab's components draw, so a voice call reads back the way
 * any other conversation of Luke's does. A call is named by the store's id
 * for its session, the same id the voice window reports beside the live
 * call's lines, which is how the tab tells the stored copy of a call from
 * the live one. A call on which nothing was said is no call here. Nothing in
 * this read is the model's: it is the words alone, by whom, on which call.
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
 * part. The id is the line's place on its call, counted from zero. Note that
 * the parts are a mutable array, as the SDK's type spells them, so a message
 * read here is one of its messages without a copy.
 */
export const transcriptMessageSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  role: EffectSchema.Literals(Object.values(TRANSCRIPT_SPEAKER)),
  parts: EffectSchema.mutable(EffectSchema.Array(transcriptTextPartSchema)),
});

export type TranscriptMessage = typeof transcriptMessageSchema.Type;

/** One call about the plan: the store's id for its session, when it started, and its messages in the order they opened. */
export const transcriptCallSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  /** Epoch milliseconds the call started. */
  startedAt: countedNumber,
  messages: EffectSchema.Array(transcriptMessageSchema),
});

/** A plan's transcript: its calls oldest first, and whether older words were left out of the read. */
export const planTranscriptSchema = EffectSchema.Struct({
  calls: EffectSchema.Array(transcriptCallSchema),
  earlierOmitted: EffectSchema.Boolean,
});

export type PlanTranscript = typeof planTranscriptSchema.Type;

/** A transcript read (GET). */
export const planTranscriptAnswerSchema = EffectSchema.Struct({ transcript: planTranscriptSchema });

/** The transcript of a plan no call has been made about. */
export const EMPTY_TRANSCRIPT: PlanTranscript = { calls: [], earlierOmitted: false };
