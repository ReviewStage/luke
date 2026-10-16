import type { DatabaseServices } from "@luke/database/core/query";
import { keepPlanAttachment, PLAN_ATTACHMENT_KEEP } from "@luke/database/models/plan-attachments";
import { readPlan } from "@luke/database/models/plan-store";
import { workspaceOf } from "@luke/database/models/workspace-store";
import { PICTURE_BOUNDS, type Picture } from "@luke/features/picture-wire";
import { planAttachmentAddress, planPictureMarkdown } from "@luke/features/plan-attachment-link";
import { PLAN_ATTACHMENT_BOUNDS } from "@luke/features/plan-attachment-wire";
import {
  NOTE_KIND,
  type PlanNote,
  planNoteSectionSchema,
  planNotesSchema,
  readNotes,
} from "@luke/features/plan-template";
import { PLAN_ACTOR } from "@luke/features/plan-wire";
import { describeWire, readEither } from "@luke/wire/effect";
import { Data, Effect, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { ACTION_RESULT_STATUS, isRecord, type UnparsedWireValue } from "../../core.js";
import { logStoreFailure, type StoreFailure } from "../../http/store-failure.js";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  type PlanDocumentBinding,
  type PlanNoteAuthor,
  saveNotes,
} from "../../plans/plan-notes.js";
import { CODER } from "./bounds.js";
import { type InboxSandboxDoor, readSandboxImage, type SandboxImageTerms } from "./inbox-image.js";

/**
 * plan-edit.ts -- the coding agent's `edit_plan` tool: the notetaker's own notes, taken into the agent's plan, and pictures from its sandbox added to it.
 *
 * An agent that meets something the plan does not settle, verifies a fact
 * the plan has wrong, or makes a decision the plan left open does not stop
 * and does not keep it to itself: it takes notes on the plan exactly as the
 * planning call's notetaker does (`plans/plan-scribe.ts`), under the same
 * schema and through the plan's one write (`plan-notes.ts`), which journals
 * the save under the agent's id, so the planning model and the developer
 * read them on the next call and see which agent wrote what. A call's notes
 * may land anywhere in the plan, its headings among it, and land together or
 * not at all: one naming what the plan does not hold exactly once answers the
 * plan as it stands, so the agent retries from it rather than from the text
 * it was handed. Note that the call answers at once, whatever was
 * saved, because the agent's turn is its whole run and nothing is answered
 * to it mid-turn; an answer reaches it as a later message. A turn may take
 * only so many notes: past the cap the agent is told to go on and name the
 * rest in its message, so a model that writes at every step cannot rewrite
 * the plan under the developer.
 *
 * Beside its notes the agent may add pictures, which the notetaker cannot,
 * having none: a screenshot it took, named by its file in its sandbox, read
 * as an inbox image's is (`inbox-image.ts`), kept as one of the plan's
 * pictures as the member the turn runs for, and written as the picture's
 * line at the end of its section, an added point like any other, so the
 * save is the agent's and its byline names it. Every file is read before any
 * picture is kept, and a call with a picture to mend saves nothing.
 */
const PLAN_EDIT = {
  /** The most notes one turn may take on the plan, across its calls, each picture one of them. */
  MAX_NOTES_PER_TURN: 40,
  /** The most pictures one call may add. */
  MAX_PICTURES_PER_CALL: 4,
  /** The most characters a picture's path in the agent's sandbox may spell. */
  MAX_PATH_CHARS: 1_024,
  /** The most characters a picture's alt text may spell: what it shows, in a sentence or two. */
  MAX_ALT_CHARS: 300,
  /** The most characters a picture's caption may spell: one short line. */
  MAX_CAPTION_CHARS: 200,
} as const;

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(maximumChars));
}

/** One picture the agent adds: its file in the sandbox, its words, and the section it goes under. */
const pictureSchema = Schema.Struct({
  section: planNoteSectionSchema,
  path: describeWire(
    trimmedText(PLAN_EDIT.MAX_PATH_CHARS),
    "The picture's file in your sandbox, such as a screenshot you took, relative to the " +
      `checkout: a PNG, JPEG, or WebP of at most ${PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB.`,
  ),
  alt: describeWire(
    trimmedText(PLAN_EDIT.MAX_ALT_CHARS),
    "What the picture shows, in a sentence: the words read in its place by anyone who cannot see it, models included.",
  ),
  caption: Schema.optionalKey(
    describeWire(trimmedText(PLAN_EDIT.MAX_CAPTION_CHARS), "A short line shown under it."),
  ),
});

type PlanPicture = typeof pictureSchema.Type;

const picturesSchema = Schema.Array(pictureSchema).check(
  Schema.isMaxLength(PLAN_EDIT.MAX_PICTURES_PER_CALL),
);

const readPictures = readEither(picturesSchema);

/** What a call carries: the notetaker's notes, and the pictures only an agent adds. */
const EDIT_PLAN_INPUT = Schema.Struct({
  ...planNotesSchema.fields,
  pictures: Schema.optionalKey(
    describeWire(
      picturesSchema,
      "Pictures to add, each at the end of its section, after the notes are taken.",
    ),
  ),
});

/** The tool as a coding agent is offered it: its name, its words, and the notetaker's own input schema with the pictures beside it. */
export const EDIT_PLAN_TOOL = {
  name: "edit_plan",
  description:
    "Take notes on the plan this conversation implements, as its notetaker does: add a point " +
    "under one of its headings, or replace text copied exactly from the saved plan, as much as " +
    "names one place, headings and whole sections included, with what it becomes, or with " +
    "nothing to delete it. A note's text may open headings of its own, so you can rename, " +
    "split, merge, move, and drop sections. Use it to record a question the plan does not answer under its open " +
    "questions together with the assumption you go on under, to correct a fact you verified in " +
    "the code, to record a hard part you met, an interface you had to change, or a decision you " +
    "made, each under the heading it belongs to. Write a file, a pull request, or an issue a note names as a Markdown " +
    "link to its page, such as [store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), so the plan draws it as a chip. " +
    "To add a picture, such as a screenshot of what you built, name its file in your sandbox " +
    "under pictures, with alt text saying what it shows. " +
    "Every save is recorded in the plan as yours. The developer reads the plan on their next " +
    "call with Luke; you do not wait for an answer. A call's notes and pictures land together " +
    "or not at all: where one names text or a heading the plan does not hold exactly once, " +
    "nothing is saved and the call answers the plan as it stands, to retry from. " +
    `A turn may take at most ${PLAN_EDIT.MAX_NOTES_PER_TURN} notes, each picture one.`,
  inputSchema: EDIT_PLAN_INPUT,
} as const;

/** Why a call saved nothing, in the words the model reads. */
export const PLAN_EDIT_REFUSAL = {
  UNREADABLE: "Not saved: the notes do not read under the plan's template.",
  TOO_MANY: `Not saved: a turn may take at most ${PLAN_EDIT.MAX_NOTES_PER_TURN} notes on the plan. Go on, and name what you would have noted in your message.`,
  UNAVAILABLE: "Not saved: the service could not reach its store.",
  NO_PLAN:
    "Not saved: you were handed a prompt rather than the plan, so there is no plan of yours to update.",
  TOO_MANY_PICTURES: `Not saved: the plan holds ${PLAN_ATTACHMENT_BOUNDS.MAX_PER_PLAN} pictures, as many as a plan may. Leave the pictures out.`,
  ARCHIVED:
    "Not saved: this task is archived, so no picture can be added to its plan. Send the notes again without the pictures.",
  CONFLICT:
    "Not saved: none of this call's notes was taken, because one names what the plan does not hold exactly once. The plan as it stands is in current; retry from it.",
} as const;

/** The most of a missed note's find its answer repeats; the plan as it stands follows it whole. */
const MISSED_FIND_CHARS = 200;

/** Why a picture's file was not read (`inbox-image.ts`), in the words the model reads; each is followed by the path. */
export const PLAN_PICTURE_FILE_REFUSAL = {
  NO_FILE: "Not saved: a picture names no file in your sandbox:",
  NOT_IMAGE: "Not saved: a picture names a file that is not a PNG, JPEG, or WebP image:",
  TOO_LARGE: `Not saved: a picture names a file larger than ${PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB; take it smaller, or at one screen scale:`,
  UNREADABLE: "Not saved: a picture's file could not be read from your sandbox:",
} as const;

/** What a picture's file is read under: a plan picture's bound, and the refusals in this tool's words. */
const PLAN_PICTURE_TERMS: SandboxImageTerms = {
  maxBytes: PICTURE_BOUNDS.MAX_BYTES,
  refusals: PLAN_PICTURE_FILE_REFUSAL,
};
/** How many notes a turn has taken, kept in eve's durable session state: the turn and its count. */
export interface NotesTaken {
  readonly turnId?: string;
  readonly count: number;
}

export const NO_NOTES_TAKEN: NotesTaken = { count: 0 };

/** How many notes the turn given has taken; a record of another turn counts for nothing. */
export function takenInTurn(taken: NotesTaken, turnId: string): number {
  return taken.turnId === turnId ? taken.count : 0;
}

/**
 * The record with a call's notes reserved against the turn's cap before the
 * save goes out, because two calls one step makes run at once and each would
 * otherwise read the count the other has not yet raised.
 */
export function reserveNotes(taken: NotesTaken, turnId: string, requested: number): NotesTaken {
  return { turnId, count: takenInTurn(taken, turnId) + requested };
}

/** The record settled once the save answered: the reservation replaced by what was taken, which is nothing for a refused call. */
export function settleNotes(
  taken: NotesTaken,
  turnId: string,
  requested: number,
  saved: number,
): NotesTaken {
  return { turnId, count: Math.max(0, takenInTurn(taken, turnId) - requested + saved) };
}

/**
 * A call's notes, or nothing where the call holds no list of notes or any
 * of its notes does not read, which refuses it whole.
 */
function notesOf(input: UnparsedWireValue): readonly PlanNote[] | undefined {
  if (!isRecord(input) || !Array.isArray(input.notes)) return undefined;
  const { notes, unread } = readNotes(input);
  return unread > 0 ? undefined : notes;
}

/**
 * A call's pictures: none where it adds none, or nothing where its pictures
 * do not read, which refuses it whole.
 */
function picturesOf(input: UnparsedWireValue): readonly PlanPicture[] | undefined {
  if (!isRecord(input)) return undefined;
  if (input.pictures === undefined) return [];
  const read = readPictures(input.pictures);
  return Result.isSuccess(read) ? read.success : undefined;
}

/** How many notes a call asks to take, each picture one, read off its input; nothing readable asks for none, and the save refuses it by name. */
export function requestedNotes(input: UnparsedWireValue): number {
  return (notesOf(input)?.length ?? 0) + (picturesOf(input)?.length ?? 0);
}

/**
 * What a call answers, as the model and the authored file read it: how many
 * notes it took, or why nothing was saved, with the note that missed and the
 * plan as it stands where the plan no longer holds what a note names.
 */
export type PlanEditResult =
  | { readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED; readonly taken: number }
  | {
      readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
      readonly reason: string;
      readonly missed?: string;
      readonly current?: string;
    };

export function planEditRejected(reason: string): PlanEditResult {
  return refused(reason);
}

/** A refusal with nothing but its reason. */
function refused(
  reason: string,
): Extract<PlanEditResult, { status: typeof ACTION_RESULT_STATUS.REJECTED }> {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** A note that missed, in the words the model reads: its kind and where it was aimed, a long find cut. */
function missedNote(note: PlanNote): string {
  if (note.kind === NOTE_KIND.ADD) return `${note.kind} under ${note.section}`;
  const find =
    note.find.length > MISSED_FIND_CHARS ? `${note.find.slice(0, MISSED_FIND_CHARS)}…` : note.find;
  return `${note.kind} ${find}`;
}

/** A picture the call adds, with its file as read from the sandbox. */
interface PictureRead {
  readonly picture: PlanPicture;
  readonly file: Picture;
}

/** Every picture's file read from the sandbox, in order, or the refusal of the first that is not, naming its path. */
function readPictureFiles(
  pictures: readonly PlanPicture[],
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<readonly PictureRead[], string>> {
  return Effect.gen(function* () {
    const read: PictureRead[] = [];
    for (const picture of pictures) {
      const { path } = picture;
      const file = yield* readSandboxImage(sandbox, CODER.CHECKOUT_PATH, path, PLAN_PICTURE_TERMS);
      if (Result.isFailure(file)) return Result.fail(file.failure);
      read.push({ picture, file: file.success });
    }
    return Result.succeed(read);
  });
}

/** A call's pictures as read before anything is kept: their files, and the workspace step their addresses are written under. */
interface PicturesRead {
  readonly slug: string;
  readonly files: readonly PictureRead[];
}

/** Why a call's save was refused inside its transaction, so the pictures kept before it are rolled back with it. */
class EditRefused extends Data.TaggedError("EditRefused")<{
  readonly refusal: Extract<PlanEditResult, { status: typeof ACTION_RESULT_STATUS.REJECTED }>;
}> {}

/**
 * The call's pictures read before anything is kept, or why none can be: the
 * plan gone or archived, or a file to mend. The plan's address names its
 * workspace by the slug the account reads it under, or by its id where the
 * workspace names none, as the desktop names it: an address is found by its
 * plan's id alone.
 */
function picturesInSandbox(
  binding: PlanDocumentBinding,
  pictures: readonly PlanPicture[],
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<PicturesRead, string>, StoreFailure, DatabaseServices> {
  if (pictures.length === 0) return Effect.succeed(Result.succeed({ slug: "", files: [] }));
  return Effect.gen(function* () {
    const stored = yield* readPlan(binding.userId, binding.planId);
    if (Option.isNone(stored)) return Result.fail(PLAN_SAVE_REFUSAL.NO_PLAN);
    const { plan } = stored.value;
    if (plan.archivedAt !== undefined) return Result.fail(PLAN_EDIT_REFUSAL.ARCHIVED);
    const workspace = yield* workspaceOf(binding.userId, plan.workspaceId);
    const slug = Option.getOrUndefined(workspace)?.slug ?? plan.workspaceId;
    const files = yield* readPictureFiles(pictures, sandbox);
    if (Result.isFailure(files)) return Result.fail(files.failure);
    return Result.succeed({ slug, files: files.success });
  });
}

/**
 * The pictures read kept on the plan as the binding's account, each written
 * as an added point, its picture's line under its section; refused where the
 * plan holds its bound of pictures, or was archived or deleted since it was
 * read. Note that this runs inside the call's transaction, so a refusal
 * keeps none of them.
 */
function keptAsNotes(
  binding: PlanDocumentBinding,
  read: PicturesRead,
): Effect.Effect<readonly PlanNote[], EditRefused | StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const notes: PlanNote[] = [];
    for (const { picture, file } of read.files) {
      const kept = yield* keepPlanAttachment(binding.userId, binding.planId, file);
      if (kept.status === PLAN_ATTACHMENT_KEEP.TOO_MANY) {
        return yield* new EditRefused({ refusal: refused(PLAN_EDIT_REFUSAL.TOO_MANY_PICTURES) });
      }
      if (kept.status === PLAN_ATTACHMENT_KEEP.NO_PLAN) {
        return yield* new EditRefused({ refusal: refused(PLAN_EDIT_REFUSAL.ARCHIVED) });
      }
      const address = planAttachmentAddress(
        { planId: binding.planId, attachmentId: kept.id },
        read.slug,
      );
      notes.push({
        kind: NOTE_KIND.ADD,
        section: picture.section,
        text: planPictureMarkdown(address, picture.alt, picture.caption),
      });
    }
    return notes;
  });
}

/**
 * Runs one call: the notes taken into the plan the binding names, its
 * pictures read from the sandbox, kept, and added after them, or the refusal
 * for notes or pictures that do not read, a turn past its cap, a picture to
 * mend, or a plan the save refused. Every file is read before the store is
 * written, and the pictures are kept and the notes saved in one transaction,
 * so a call refused anywhere keeps no picture to hold a place in the plan's
 * bound. Note that `takenInTurn` is the caller's count of this turn's notes,
 * because the count lives in eve's session state, which only the authored
 * file can read.
 */
export function recordPlanEdit(
  binding: PlanDocumentBinding,
  author: PlanNoteAuthor,
  input: UnparsedWireValue,
  takenInTurn: number,
  sandbox: InboxSandboxDoor,
): Effect.Effect<PlanEditResult, never, DatabaseServices> {
  const notes = notesOf(input);
  const pictures = picturesOf(input);
  if (notes === undefined || pictures === undefined) {
    return Effect.succeed(planEditRejected(PLAN_EDIT_REFUSAL.UNREADABLE));
  }
  if (takenInTurn + notes.length + pictures.length > PLAN_EDIT.MAX_NOTES_PER_TURN) {
    return Effect.succeed(planEditRejected(PLAN_EDIT_REFUSAL.TOO_MANY));
  }
  const writer = { actor: PLAN_ACTOR.AGENT, agentId: author.agentId } as const;
  const saved = (read: PicturesRead) =>
    Effect.gen(function* () {
      const all = [...notes, ...(yield* keptAsNotes(binding, read))];
      const save = yield* saveNotes(binding, all, writer);
      if (save.status === PLAN_SAVE_STATUS.CONFLICT) {
        const refusal = {
          ...refused(PLAN_EDIT_REFUSAL.CONFLICT),
          missed: missedNote(save.missed),
          current: save.current,
        };
        return yield* new EditRefused({ refusal });
      }
      if (save.status !== PLAN_SAVE_STATUS.SAVED) {
        return yield* new EditRefused({ refusal: refused(save.reason) });
      }
      return { status: ACTION_RESULT_STATUS.ACCEPTED, taken: all.length } satisfies PlanEditResult;
    });
  return Effect.gen(function* () {
    const read = yield* picturesInSandbox(binding, pictures, sandbox);
    if (Result.isFailure(read)) return planEditRejected(read.failure);
    const client = yield* SqlClient.SqlClient;
    return yield* client.withTransaction(saved(read.success));
  }).pipe(
    Effect.catchTag("EditRefused", ({ refusal }) => Effect.succeed(refusal)),
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(planEditRejected(PLAN_EDIT_REFUSAL.UNAVAILABLE))),
  );
}
