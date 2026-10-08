import {
  applyNotes,
  NOTE_KIND,
  notesInProgress,
  type PlanContent,
  type PlanNote,
  planBody,
  planNotesSchema,
  readNotes,
} from "@sidecar/hosted/plan-template";
import { PLAN_BOUNDS, type PlanDocument } from "@sidecar/hosted/plan-wire";
import {
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
  renderAskContext,
  TRANSCRIPT_SPEAKER,
  TranscriptLedger,
  type TranscriptUtterance,
} from "@sidecar/live";
import { LIVE_BRAIN_RUN_EVENT, type LiveBrainRunEvent } from "@sidecar/voice/live-session";
import {
  jsonRoundTrip,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { jsonSchema, type LanguageModel, Output, streamText } from "ai";
import { Cause, Clock, Data, Duration, Effect, Option, Queue, type Scope, Stream } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SCRIBE_INSTRUCTIONS } from "../hosted/brain-host/planning.js";
import { PLAN_SAVE_STATUS, saveNotes } from "../hosted/plan-notes.js";
import { readPlan } from "../hosted/plan-store.js";
import { spendHostedMeter } from "../hosted/quota.js";

/**
 * plan-scribe.ts -- a planning call's notetaker: it listens to the call and writes the plan while Luke and the developer talk.
 *
 * GPT-Live's own guidance for side work is to react to the transcript as it
 * arrives, on a small model, while speech goes on; this is that for the plan.
 * The scribe keeps its own ledger of both speakers' words from the sideband
 * and the brain's reply sentences as Luke's research notes, and once the
 * call has been quiet for a beat, whoever spoke last, it makes one model call
 * over what was said since its cursor, which answers with notes: a point
 * added under a field, an example added to a rule, a phrase corrected, or a
 * line struck. They are saved through `saveNotes`, the plan's one write.
 * While the model writes, the notes so far go to the device as a draft of the
 * plan (`notesInProgress`), each draft differing from the last only where the
 * newest note lands, so the Plans tab types each note in as it is taken. It is the plan's only writer and its
 * runs never overlap, one fiber reading the debounced stream in turn, so no
 * save races another. A run that fails, is refused, or saves nothing moves no
 * cursor, and the next run is handed those lines again. The scribe decides
 * nothing of the call: nothing it does is said aloud or reaches the voice.
 *
 * Note that GPT-Live marks no end of a turn, so the quiet is the turn
 * boundary, and Luke's turns start a run as the developer's do: what he
 * relays from the backend belongs in the plan too, and a notetaker that
 * waited on the developer left it unwritten while they listened.
 */

export const PLAN_SCRIBE = {
  /** A small, fast model for the side work, as the GPT-Live guide suggests; the brain stays on its own. */
  MODEL: "gpt-5.6-luna",
  /** How long the call is quiet before what was said is written down. */
  QUIET_MS: 1_000,
  /** How long one run's model call may take before it is given up and its lines left for the next. */
  TIMEOUT_MS: 30_000,
  /** How many lines before the new ones ride along as context, so an answer is read against its question. */
  CONTEXT_LINES: 4,
  /** The least time between two drafts sent while the model writes, so the device gets a steady flow rather than every token. */
  DRAFT_EVERY_MS: 150,
  MAXIMUM_OUTPUT_TOKENS: 8_000,
} as const;

/** The markers each part of the scribe's ask rides behind, so the model reads what follows as data. */
const ASK_MARKER = {
  PLAN: "[saved plan]",
  EARLIER: "[earlier lines]",
  LATEST: "[latest lines]",
  NOTES: "[Luke's research notes]",
} as const;

/** The notes' schema as the model is shown it: the template's own, in the plain-object form the SDK takes. */
const NOTES_OUTPUT = Output.object({
  schema: jsonSchema<unknown>(jsonRoundTrip(emitJsonSchema(planNotesSchema))),
});

export interface PlanScribeOptions {
  readonly userId: string;
  readonly planId: string;
  /** The deployment's model for the scribe; a test hands in a mock. */
  readonly model: LanguageModel;
  /** Where each draft of the plan goes as it is written, and the saved document once it lands. */
  readonly onDraft?: (draft: PlanDraft) => void;
  /** Whether a run's model call is writing: true as it starts, false once it ends however it ends. */
  readonly onWriting?: (writing: boolean) => void;
  readonly createId: () => string;
  readonly report: (message: string) => void;
}

/** The plan's document as the notetaker has it now: a draft, or with the instant of its save once it is saved. */
export interface PlanDraft {
  readonly document: PlanDocument;
  readonly savedAt?: number;
}

export interface PlanScribe {
  /** Hears one live event: a transcript fragment is noted, and the developer's words start the quiet over. */
  readonly observe: (event: LiveServerEvent) => void;
  /** Hears one of the brain's run events, keeping its reply sentences as research notes. */
  readonly observeRun: (event: LiveBrainRunEvent) => void;
}

/** The model call's own failure, the provider's or the network's, with its words bounded for the report. */
class ScribeModelError extends Data.TaggedError("ScribeModelError")<{
  readonly reason: string;
}> {}

/** What one run hands the model: the saved plan's fields, the lines around the cursor, and the notes since it. */
function askText(input: {
  readonly plan: string;
  readonly earlier: readonly TranscriptUtterance[];
  readonly latest: readonly TranscriptUtterance[];
  readonly notes: readonly string[];
}): string {
  const parts = [ASK_MARKER.PLAN, input.plan];
  if (input.earlier.length > 0) {
    parts.push(ASK_MARKER.EARLIER, renderAskContext({ turns: input.earlier, ask: undefined }));
  }
  parts.push(ASK_MARKER.LATEST, renderAskContext({ turns: input.latest, ask: undefined }));
  if (input.notes.length > 0) parts.push(ASK_MARKER.NOTES, input.notes.join(" "));
  return parts.join("\n");
}

/** A note passed over, in words for the report: its kind and field, and never its text. */
function missedNote(note: PlanNote): string {
  return note.kind === NOTE_KIND.ADD_EXAMPLE
    ? `${note.kind} rule ${note.rule}`
    : `${note.kind} ${note.field}`;
}

export const planScribe = /* @__PURE__ */ Effect.fn("web/planScribe")(function* (
  options: PlanScribeOptions,
): Effect.fn.Return<PlanScribe, never, Scope.Scope | SqlClient.SqlClient> {
  const sql = yield* SqlClient.SqlClient;
  const ledger = new TranscriptLedger({ mintRowId: options.createId });
  const notes: string[] = [];
  /** Where the last run that landed stopped: the session-timeline instant heard through, and the notes read. */
  const cursor = { heardThrough: Number.NEGATIVE_INFINITY, notesRead: 0 };
  const heard = yield* Queue.unbounded<void>();

  /** The model call's failure, its words bounded for the report. */
  const modelError = (failed: Error | string) =>
    new ScribeModelError({
      reason: (failed instanceof Error ? failed.message : failed).slice(0, 200),
    });

  /**
   * One run over what was said since the cursor. The lines and the notes are
   * read before the model is asked, so words heard during the call are left
   * past the cursor for the next run rather than skipped. While the model
   * writes, the notes so far are taken over the stored fields and formatted
   * exactly as a save would be, and sent to the device as a draft at most
   * once a beat; the save's own document follows it, and a run that saves
   * nothing sends the stored document back so no half-written draft is left
   * standing.
   */
  const run = Effect.gen(function* () {
    const latest = ledger.utterances(undefined, { sinceMs: cursor.heardThrough });
    if (latest.length === 0) return;
    const heardThrough = ledger.lastActivityMs() ?? cursor.heardThrough;
    const notesRead = notes.length;
    const stored = yield* readPlan(options.userId, options.planId);
    if (Option.isNone(stored)) return;
    const spent = yield* spendHostedMeter({
      userId: options.userId,
      now: yield* Clock.currentTimeMillis,
    });
    if (!spent.allowed) {
      options.report("The plan's notetaker wrote nothing: the day's allowance is spent");
      return;
    }
    const earlier = ledger
      .utterances()
      .filter((line) => line.endMs <= cursor.heardThrough)
      .slice(-PLAN_SCRIBE.CONTEXT_LINES);
    const { plan, fields } = stored.value;
    const header = { name: plan.name };
    const content: PlanContent = { fields, assumptions: plan.document.assumptions };
    const drafted = { at: Number.NEGATIVE_INFINITY, landed: false };

    /** The document content would save, formatted as the save formats it; nothing past the body's bound. */
    const documentOf = (noted: PlanContent): PlanDocument | undefined => {
      const body = planBody(header, noted.fields);
      if (body.length > PLAN_BOUNDS.MAX_BODY_CHARS) return undefined;
      return { body, assumptions: noted.assumptions };
    };

    const draft = (partial: UnparsedWireValue) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (now - drafted.at < PLAN_SCRIBE.DRAFT_EVERY_MS) return;
        const document = documentOf(notesInProgress(content, partial));
        if (document === undefined) return;
        drafted.at = now;
        options.onDraft?.({ document });
      });

    const written = Effect.gen(function* () {
      const streamed = yield* Effect.try({
        try: () =>
          streamText({
            model: options.model,
            system: SCRIBE_INSTRUCTIONS,
            prompt: askText({
              plan: JSON.stringify(content),
              earlier,
              latest,
              notes: notes.slice(cursor.notesRead),
            }),
            output: NOTES_OUTPUT,
            maxOutputTokens: PLAN_SCRIBE.MAXIMUM_OUTPUT_TOKENS,
            // Note that a note's kinds carry different keys, which OpenAI's strict
            // structured outputs refuse, so the schema is sent loose and every note
            // is read under the schema itself.
            providerOptions: { openai: { strictJsonSchema: false, reasoningEffort: "low" } },
          }),
        catch: (error) => modelError(error instanceof Error ? error : String(error)),
      });
      yield* Stream.fromAsyncIterable(streamed.partialOutputStream, (error) =>
        modelError(error instanceof Error ? error : String(error)),
      ).pipe(
        // SAFETY: the SDK hands back the partial JSON the model has emitted so far; each note is read under the schema in the draft.
        Stream.map((partial) => unparsedWire(partial as WireBoundaryInput)),
        Stream.runForEach(draft),
      );
      const output = yield* Effect.tryPromise({
        try: async () => await streamed.output,
        catch: (error) => modelError(error instanceof Error ? error : String(error)),
      });
      // SAFETY: the SDK hands back the JSON object the model emitted; each note is read under the schema at once.
      return readNotes(unparsedWire(output as WireBoundaryInput));
    }).pipe(Effect.timeout(Duration.millis(PLAN_SCRIBE.TIMEOUT_MS)));

    const landed = Effect.gen(function* () {
      options.onWriting?.(true);
      const output = yield* Effect.ensuring(
        written,
        Effect.sync(() => options.onWriting?.(false)),
      );
      if (output.unread > 0) {
        options.report(`The plan's notetaker took ${output.unread} notes outside the template`);
      }
      const taken = applyNotes(content, output.notes);
      if (taken.missed.length > 0) {
        const missed = taken.missed.map(missedNote).join(", ");
        options.report(`The plan's notetaker named what the plan does not hold: ${missed}`);
      }
      // Notes that change nothing are the model saying nothing new was said, and need no save.
      if (taken.content !== content) {
        const saved = yield* saveNotes(
          { userId: options.userId, planId: options.planId, header },
          output.notes,
        );
        if (saved.status !== PLAN_SAVE_STATUS.SAVED) {
          options.report(`The plan's notetaker could not save: ${saved.reason}`);
          return;
        }
        drafted.landed = true;
        options.onDraft?.({ document: saved.document, savedAt: saved.savedAt });
      }
      cursor.heardThrough = heardThrough;
      cursor.notesRead = notesRead;
    });

    yield* Effect.ensuring(
      landed,
      Effect.sync(() => {
        if (drafted.at > Number.NEGATIVE_INFINITY && !drafted.landed) {
          options.onDraft?.({ document: plan.document });
        }
      }),
    );
  }).pipe(
    Effect.provideService(SqlClient.SqlClient, sql),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.sync(() =>
            options.report(`The plan's notetaker could not write: ${Cause.pretty(cause)}`),
          ),
    ),
  );

  yield* Stream.fromQueue(heard).pipe(
    Stream.debounce(Duration.millis(PLAN_SCRIBE.QUIET_MS)),
    Stream.runForEach(() => run),
    Effect.forkScoped,
  );

  return {
    observe: (event) => {
      if (event.type === LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA) {
        ledger.append({
          speaker: TRANSCRIPT_SPEAKER.USER,
          text: event.delta,
          startMs: event.start_ms,
          endMs: event.end_ms,
        });
        Queue.offerUnsafe(heard, undefined);
      } else if (event.type === LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA) {
        ledger.append({
          speaker: TRANSCRIPT_SPEAKER.ASSISTANT,
          text: event.delta,
          startMs: event.start_ms,
          endMs: event.end_ms,
        });
        Queue.offerUnsafe(heard, undefined);
      }
    },
    observeRun: (event) => {
      if (event.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE) notes.push(event.sentence);
    },
  };
});
