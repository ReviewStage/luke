import type { DatabaseServices } from "@luke/database/core/query";
import { spendHostedMeter } from "@luke/database/models/quota";
import { readStartedText, readTask, type StoredTask } from "@luke/database/models/task-store";
import {
  applyNotesToText,
  type PlanNote,
  planNotesSchema,
  readNotes,
  textNotesInProgress,
} from "@luke/features/plan-template";
import {
  PLAN_ACTOR,
  type PlanDocument,
  type PlanSectionEdit,
  TASK_BOUNDS,
} from "@luke/features/task-wire";
import {
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
  renderAskContext,
  TRANSCRIPT_SPEAKER,
  TranscriptLedger,
  type TranscriptUtterance,
} from "@luke/live";
import { LIVE_BRAIN_RUN_EVENT, type LiveBrainRunEvent } from "@luke/voice/live-session";
import {
  jsonRoundTrip,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { jsonSchema, type LanguageModel, Output, streamText } from "ai";
import { Cause, Clock, Data, Duration, Effect, Option, Queue, type Scope, Stream } from "effect";
import { SqlClient } from "effect/sql";
import { DEVELOPER_FIELDS_MARKER, SCRIBE_INSTRUCTIONS } from "../agents/brain-host/brain.js";
import { PLAN_SAVE_STATUS, saveNotes } from "./plan-notes.js";

/**
 * plan-scribe.ts -- a task call's notetaker: it listens to the call and writes the plan while Luke and the developer talk.
 *
 * GPT-Live's own guidance for side work is to react to the transcript as it
 * arrives, on a small model, while speech goes on; this is that for the plan.
 * The scribe keeps its own ledger of both speakers' words from the sideband
 * and the brain's reply sentences as Luke's research notes, and once the
 * call has been quiet for a beat, whoever spoke last, it makes one model call
 * over what was said since its cursor, which answers with notes: a point
 * added under a heading, a phrase corrected, a line struck, or a section
 * struck or moved, anywhere in the plan, its headings among it. They are
 * saved through `saveNotes`, the plan's one write, under the call, so the
 * plan's history keeps the call's saves as one revision, and taken whole or
 * not at all: an answer holding a note that does not read or names what the
 * plan does not hold exactly once saves nothing, and its lines are handed to
 * the next run with the plan as it then stands.
 * While the model writes, the notes so far go to the device as a draft of the
 * plan (`textNotesInProgress`), each draft differing from the last only where the
 * newest note lands, so the Tasks tab types each note in as it is taken. It is the plan's only writer and its
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
  /** The plan's Markdown text. */
  DOCUMENT: "[saved plan]",
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
  readonly taskId: string;
  /** The call the scribe listens to, which every save it makes is kept under in the plan's history. */
  readonly liveSessionId: string;
  /** The deployment's model for the scribe; a test hands in a mock. */
  readonly model: LanguageModel;
  /** Where each draft of the plan goes as it is written, and the saved document once it lands. */
  readonly onDraft?: (draft: PlanDraft) => void;
  /** Whether a run's model call is writing: true as it starts, false once it ends however it ends. */
  readonly onWriting?: (writing: boolean) => void;
  readonly createId: () => string;
  readonly report: (message: string) => void;
}

/**
 * The plan's document as the notetaker has it now: a draft, or with the
 * instant of its save and who last changed each section once it is saved.
 * Each names the save the run read before it wrote, so a window that saved an
 * edit of its own since can tell a draft that does not hold it.
 */
export interface PlanDraft {
  readonly document: PlanDocument;
  /** Epoch milliseconds of the save the run read. */
  readonly readAt: number;
  readonly savedAt?: number;
  /** The save that last changed each section, once this one is saved. */
  readonly sectionEdits?: readonly PlanSectionEdit[];
}

/**
 * How one run reads the plan and what its notes make of it: the plan as the
 * model is handed it, under its marker, the document a draft of notes so far
 * draws, nothing past the plan's bound, and whether whole notes change it,
 * or the first that could not be taken, which refuses them all.
 */
interface NotedTask {
  readonly marker: string;
  readonly asked: string;
  readonly drafted: (partial: UnparsedWireValue) => PlanDocument | undefined;
  readonly taken: (notes: readonly PlanNote[]) => {
    readonly changed: boolean;
    readonly missed?: PlanNote;
  };
}

/**
 * A plan that is one document: handed as its text, and drawn as its text with
 * the notes so far taken over the template it started as, exactly as the
 * save takes them.
 */
function notedText(text: string, started: string): NotedTask {
  return {
    marker: ASK_MARKER.DOCUMENT,
    asked: text,
    drafted: (partial) => {
      const body = textNotesInProgress(text, partial, started);
      return body.length > TASK_BOUNDS.MAX_BODY_CHARS ? undefined : { body, assumptions: [] };
    },
    taken: (notes) => {
      const noted = applyNotesToText(text, notes, started);
      return noted.missed === undefined
        ? { changed: noted.text !== text }
        : { changed: false, missed: noted.missed };
    },
  };
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

/** What one run hands the model: the saved plan, the sections the developer wrote, the lines around the cursor, and the notes since it. */
function askText(input: {
  readonly task: NotedTask;
  readonly developerFields: readonly string[];
  readonly earlier: readonly TranscriptUtterance[];
  readonly latest: readonly TranscriptUtterance[];
  readonly notes: readonly string[];
}): string {
  const parts = [input.task.marker, input.task.asked];
  if (input.developerFields.length > 0) {
    parts.push(DEVELOPER_FIELDS_MARKER, input.developerFields.join(", "));
  }
  if (input.earlier.length > 0) {
    parts.push(ASK_MARKER.EARLIER, renderAskContext({ turns: input.earlier, ask: undefined }));
  }
  parts.push(ASK_MARKER.LATEST, renderAskContext({ turns: input.latest, ask: undefined }));
  if (input.notes.length > 0) parts.push(ASK_MARKER.NOTES, input.notes.join(" "));
  return parts.join("\n");
}

/** A note passed over, in words for the report: its kind, and never its words or the developer's heading. */
function missedNote(note: PlanNote): string {
  return note.kind;
}

/** The sections the developer wrote last, by heading, as the model is told them. */
function developerWritten(stored: StoredTask): readonly string[] {
  return stored.sectionWriters.flatMap((writer) =>
    writer.actor === PLAN_ACTOR.DEVELOPER ? [writer.section] : [],
  );
}

export const planScribe = /* @__PURE__ */ Effect.fn("web/planScribe")(function* (
  options: PlanScribeOptions,
): Effect.fn.Return<PlanScribe, never, Scope.Scope | DatabaseServices> {
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
   * writes, the notes so far are taken over the stored text and drawn
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
    const stored = yield* readTask(options.userId, options.taskId);
    if (Option.isNone(stored)) return;
    yield* spendHostedMeter({ userId: options.userId, now: yield* Clock.currentTimeMillis });
    const earlier = ledger
      .utterances()
      .filter((line) => line.endMs <= cursor.heardThrough)
      .slice(-PLAN_SCRIBE.CONTEXT_LINES);
    const { task, text } = stored.value;
    const developerFields = developerWritten(stored.value);
    const noted = notedText(text, yield* readStartedText(options.userId, task.createdAt));
    const drafted = { at: Number.NEGATIVE_INFINITY, landed: false };

    const draft = (partial: UnparsedWireValue) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (now - drafted.at < PLAN_SCRIBE.DRAFT_EVERY_MS) return;
        const document = noted.drafted(partial);
        if (document === undefined) return;
        drafted.at = now;
        options.onDraft?.({ document, readAt: task.updatedAt });
      });

    const written = Effect.gen(function* () {
      const streamed = yield* Effect.try({
        try: () =>
          streamText({
            model: options.model,
            system: SCRIBE_INSTRUCTIONS,
            prompt: askText({
              task: noted,
              developerFields,
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
      // An answer is one edit: a note that does not read, or names what the plan does not hold, refuses it whole.
      if (output.unread > 0) {
        options.report(`The plan's notetaker took ${output.unread} notes outside the template`);
        return;
      }
      const taken = noted.taken(output.notes);
      if (taken.missed !== undefined) {
        const missed = missedNote(taken.missed);
        options.report(`The plan's notetaker named what the plan does not hold: ${missed}`);
        return;
      }
      // Notes that change nothing are the model saying nothing new was said, and need no save.
      if (taken.changed) {
        const saved = yield* saveNotes(
          { userId: options.userId, taskId: options.taskId },
          output.notes,
          { actor: PLAN_ACTOR.NOTETAKER, liveSessionId: options.liveSessionId },
        );
        if (saved.status === PLAN_SAVE_STATUS.CONFLICT) {
          const missed = missedNote(saved.missed);
          options.report(`The plan's notetaker named what the plan no longer holds: ${missed}`);
          return;
        }
        if (saved.status !== PLAN_SAVE_STATUS.SAVED) {
          options.report(`The plan's notetaker could not save: ${saved.reason}`);
          return;
        }
        drafted.landed = true;
        // A save whose notes all missed under the lock, the plan written meanwhile, is no edit of Luke's.
        options.onDraft?.(
          saved.moved
            ? {
                document: saved.document,
                readAt: task.updatedAt,
                savedAt: saved.savedAt,
                sectionEdits: saved.sectionEdits,
              }
            : { document: saved.document, readAt: task.updatedAt },
        );
      }
      cursor.heardThrough = heardThrough;
      cursor.notesRead = notesRead;
    });

    yield* Effect.ensuring(
      landed,
      Effect.sync(() => {
        if (drafted.at > Number.NEGATIVE_INFINITY && !drafted.landed) {
          options.onDraft?.({ document: task.document, readAt: task.updatedAt });
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
