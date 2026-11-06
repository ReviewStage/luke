import type { DatabaseServices } from "@repo/database/core/query";
import {
  DESCRIPTION_ATTACHMENT_KEEP,
  keepDescriptionAttachment,
} from "@repo/database/models/description-attachments";
import type { DescriptionWriter } from "@repo/database/models/description-revisions";
import { readTaskHeader } from "@repo/database/models/task-store";
import { workspaceOf } from "@repo/database/models/workspace-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  descriptionAttachmentAddress,
  taskPictureMarkdown,
} from "@repo/features/description-attachment-link";
import { DESCRIPTION_ATTACHMENT_BOUNDS } from "@repo/features/description-attachment-wire";
import {
  type DescriptionNote,
  descriptionNoteSectionSchema,
  descriptionNotesSchema,
  NOTE_KIND,
  readNotes,
} from "@repo/features/description-notes";
import { PICTURE_BOUNDS, type Picture } from "@repo/features/picture-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { DESCRIPTION_ACTOR } from "@repo/features/task-wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Data, Effect, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import {
  ACTION_RESULT_STATUS,
  EXCESS_KEYS,
  isRecord,
  type UnparsedWireValue,
  wireUuidSchema,
} from "../../core.js";
import { logStoreFailure, type StoreFailure } from "../../http/store-failure.js";
import {
  DESCRIPTION_SAVE_REFUSAL,
  DESCRIPTION_SAVE_STATUS,
  type DescriptionDocumentBinding,
  type DescriptionNoteAuthor,
  saveNotes,
} from "../../tasks/description-notes.js";
import { CODER } from "./bounds.js";
import { type InboxSandboxDoor, readSandboxMedia } from "./inbox-image.js";

/**
 * description-edit.ts -- the coding agent's `edit_description` tool: the notetaker's own notes, taken into the plan of the task it names, and pictures from its sandbox added to it.
 *
 * An agent that meets something the plan does not settle, verifies a fact
 * the plan has wrong, or makes a decision the plan left open does not stop
 * and does not keep it to itself: it takes notes on the plan through the
 * plan's one write (`description-notes.ts`), which journals the save under the
 * agent's id, so the developer and the other agents read them and see which
 * agent wrote what. Every call names the task whose plan it edits, its own
 * or any other of its workspace, as a pilot fixes a child task's plan, so
 * an agent on no task edits one too; the store writes only a task the
 * member whose turn it is reaches (`agent-doors.ts`). A call's notes
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
 * having none: a screenshot it took, or a WebM it recorded of a flow, named
 * by its file in its sandbox, read as an inbox post's is (`inbox-image.ts`),
 * a recording as it is and up to a video's bound, kept as one of the plan's
 * pictures as the member the turn runs for, and written as the picture's
 * line at the end of its section, an added point like any other, so the
 * save is the agent's and its byline names it. Every file is read before any
 * picture is kept, and a call with a picture to mend saves nothing.
 *
 * A member's own notes, which an outside agent takes for them through the
 * member MCP server, go through the same save, written as the developer's
 * and with no picture (`recordMemberDescriptionNotes`).
 */
const DESCRIPTION_EDIT = {
  /** The most notes one turn may take on the plan, across its calls, each picture one of them. */
  MAX_NOTES_PER_TURN: 40,
  MAX_PICTURES_PER_CALL: 4,
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
  section: descriptionNoteSectionSchema,
  path: describeWire(
    trimmedText(DESCRIPTION_EDIT.MAX_PATH_CHARS),
    "The picture's file in your sandbox, such as a screenshot you took or a recording you made of " +
      `a flow, relative to your working folder or absolute: a PNG, JPEG, or WebP of at most ${PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB, ` +
      `or a WebM video of at most ${PICTURE_BOUNDS.MAX_VIDEO_BYTES / 1_000_000} MB, which the plan plays.`,
  ),
  alt: describeWire(
    trimmedText(DESCRIPTION_EDIT.MAX_ALT_CHARS),
    "What the picture shows, in a sentence: the words read in its place by anyone who cannot see it, models included.",
  ),
  caption: Schema.optionalKey(
    describeWire(trimmedText(DESCRIPTION_EDIT.MAX_CAPTION_CHARS), "A short line shown under it."),
  ),
});

type TaskPicture = typeof pictureSchema.Type;

const picturesSchema = Schema.Array(pictureSchema).check(
  Schema.isMaxLength(DESCRIPTION_EDIT.MAX_PICTURES_PER_CALL),
);

const readPictures = readEither(picturesSchema);

const editedTaskSchema = Schema.Struct({ taskId: wireUuidSchema });

// The call's notes and pictures stand beside its task, and are read on their own.
const readEditedTask = readEither(editedTaskSchema, { excess: EXCESS_KEYS.DROP });

/** What a call carries: the task whose plan it edits, the notetaker's notes, and the pictures only an agent adds. */
const EDIT_DESCRIPTION_INPUT = Schema.Struct({
  taskId: describeWire(
    wireUuidSchema,
    `The task whose plan to edit, your own or another of your workspace, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  ),
  ...descriptionNotesSchema.fields,
  pictures: Schema.optionalKey(
    describeWire(
      picturesSchema,
      "Pictures to add, each at the end of its section, after the notes are taken.",
    ),
  ),
});

/** The tool as a coding agent is offered it: its name, its words, and the notetaker's own input schema with the pictures beside it. */
export const EDIT_DESCRIPTION_TOOL = {
  name: "edit_description",
  description:
    "Take notes on the plan of the task taskId names, your own task or any other of your " +
    `workspace, which ${AGENT_TOOL.READ_TASK} reads first, as its notetaker does: add a point ` +
    "under one of its headings, or replace text copied exactly from the saved plan, as much as " +
    "names one place, headings and whole sections included, with what it becomes, or with " +
    "nothing to delete it. A note's text may open headings of its own, so you can rename, " +
    "split, merge, move, and drop sections. Use it to record a question the plan does not answer under its open " +
    "questions together with the assumption you go on under, to correct a fact you verified in " +
    "the code, to record a hard part you met, an interface you had to change, or a decision you " +
    "made, each under the heading it belongs to. Write a file, a pull request, or an issue a note names as a mention, " +
    "a Markdown link to its page whose words start with @, such as [@store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), so the plan draws it as a chip. " +
    "To add a picture, such as a screenshot of what you built, name its file in your sandbox " +
    "under pictures, with alt text saying what it shows. " +
    "Every save is recorded in the plan as yours. The developer reads the plan when they next " +
    `open it in ${PRODUCT_NAME}; you do not wait for an answer. A call's notes and pictures land together ` +
    "or not at all: where one names text or a heading the plan does not hold exactly once, " +
    "nothing is saved and the call answers the plan as it stands, to retry from. " +
    `A turn may take at most ${DESCRIPTION_EDIT.MAX_NOTES_PER_TURN} notes, each picture one.`,
  inputSchema: EDIT_DESCRIPTION_INPUT,
} as const;

/** Why a call saved nothing, in the words the model reads. */
export const DESCRIPTION_EDIT_REFUSAL = {
  UNREADABLE: "Not saved: the notes do not read under the notes' schema.",
  TOO_MANY: `Not saved: a turn may take at most ${DESCRIPTION_EDIT.MAX_NOTES_PER_TURN} notes on the plan. Go on, and name what you would have noted in your message.`,
  UNAVAILABLE: "Not saved: the service could not reach its store.",
  OFF: "Not saved: your developer has Plans off, so no plan is written. Say in your message what you would have noted.",
  NO_TASK_NAMED: `Not saved: name the task whose plan to edit as taskId, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  NO_TASK: `Not saved: no task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
  NO_TURN:
    "Not saved: your turn is not recorded yet, so its notes cannot be counted. Try again in a moment.",
  TOO_MANY_PICTURES: `Not saved: the plan holds ${DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION} pictures, as many as a plan may. Leave the pictures out.`,
  TOO_MANY_VIDEOS: `Not saved: the plan holds ${DESCRIPTION_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_DESCRIPTION} videos, as many as a plan may. Leave the videos out, or show them with show_image instead.`,
  TASK_GONE: "Not saved: this task no longer exists, so no picture can be added to its plan.",
  CONFLICT:
    "Not saved: none of this call's notes was taken, because one names what the plan does not hold exactly once. The plan as it stands is in current; retry from it.",
} as const;

/** The most of a missed note's find its answer repeats; the plan as it stands follows it whole. */
const MISSED_FIND_CHARS = 200;

/** Why a picture's file was not read (`inbox-image.ts`), in the words the model reads; each is followed by the path. */
export const TASK_PICTURE_FILE_REFUSAL = {
  NO_FILE: "Not saved: a picture names no file in your sandbox:",
  NOT_IMAGE:
    "Not saved: a picture names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size:",
  TOO_LARGE: `Not saved: a picture names an image larger than ${PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB, or a video larger than ${PICTURE_BOUNDS.MAX_VIDEO_BYTES / 1_000_000} MB; take it smaller, or at one screen scale, or record a shorter flow:`,
  UNREADABLE: "Not saved: a picture's file could not be read from your sandbox:",
} as const;
/** How many notes a turn has taken: the turn and its count. */
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

/** The task a call names, or nothing where it names none that reads, which refuses it whole. */
export function editedTaskOf(input: UnparsedWireValue): string | undefined {
  const read = readEditedTask(input);
  return Result.isSuccess(read) ? read.success.taskId : undefined;
}

/**
 * A call's notes, or nothing where the call holds no list of notes or any
 * of its notes does not read, which refuses it whole.
 */
function notesOf(input: UnparsedWireValue): readonly DescriptionNote[] | undefined {
  if (!isRecord(input) || !Array.isArray(input.notes)) return undefined;
  const { notes, unread } = readNotes(input);
  return unread > 0 ? undefined : notes;
}

/**
 * A call's pictures: none where it adds none, or nothing where its pictures
 * do not read, which refuses it whole.
 */
function picturesOf(input: UnparsedWireValue): readonly TaskPicture[] | undefined {
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
 * What a call answers, as the model reads it: how many
 * notes it took, or why nothing was saved, with the note that missed and the
 * plan as it stands where the plan no longer holds what a note names.
 */
export type DescriptionEditResult =
  | { readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED; readonly taken: number }
  | {
      readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
      readonly reason: string;
      readonly missed?: string;
      readonly current?: string;
    };

export function descriptionEditRejected(reason: string): DescriptionEditResult {
  return refused(reason);
}

function refused(
  reason: string,
): Extract<DescriptionEditResult, { status: typeof ACTION_RESULT_STATUS.REJECTED }> {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** A note that missed, in the words the model reads: its kind and where it was aimed, a long find cut. */
function missedNote(note: DescriptionNote): string {
  if (note.kind === NOTE_KIND.ADD) return `${note.kind} under ${note.section}`;
  const find =
    note.find.length > MISSED_FIND_CHARS ? `${note.find.slice(0, MISSED_FIND_CHARS)}…` : note.find;
  return `${note.kind} ${find}`;
}

/** A picture the call adds, with its file as read from the sandbox. */
interface PictureRead {
  readonly picture: TaskPicture;
  readonly file: Picture;
}

/**
 * Every picture's file read from the sandbox, in order, or the refusal of
 * the first that is not, naming its path. Note that a file is read under an
 * inbox post's bounds, because a plan holds an image and a recording to the
 * same two (`PICTURE_BOUNDS`).
 */
function readPictureFiles(
  pictures: readonly TaskPicture[],
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<readonly PictureRead[], string>> {
  return Effect.gen(function* () {
    const read: PictureRead[] = [];
    for (const picture of pictures) {
      const { path } = picture;
      const file = yield* readSandboxMedia(
        sandbox,
        CODER.CHECKOUT_PATH,
        path,
        TASK_PICTURE_FILE_REFUSAL,
      );
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

/** A call that adds no picture: nothing read, and no address to write. */
const NO_PICTURES: PicturesRead = { slug: "", files: [] };

/** Why a call's save was refused inside its transaction, so the pictures kept before it are rolled back with it. */
class EditRefused extends Data.TaggedError("EditRefused")<{
  readonly refusal: Extract<
    DescriptionEditResult,
    { status: typeof ACTION_RESULT_STATUS.REJECTED }
  >;
}> {}

/**
 * The call's pictures read before anything is kept, or why none can be: the
 * plan gone or archived, or a file to mend. The plan's address names its
 * workspace by the slug the account reads it under, or by its id where the
 * workspace names none, as the desktop names it: an address is found by its
 * plan's id alone.
 */
function picturesInSandbox(
  binding: DescriptionDocumentBinding,
  pictures: readonly TaskPicture[],
  sandbox: InboxSandboxDoor,
): Effect.Effect<Result.Result<PicturesRead, string>, StoreFailure, DatabaseServices> {
  if (pictures.length === 0) return Effect.succeed(Result.succeed(NO_PICTURES));
  return Effect.gen(function* () {
    const stored = yield* readTaskHeader(binding.userId, binding.taskId);
    if (Option.isNone(stored)) return Result.fail(DESCRIPTION_SAVE_REFUSAL.NO_TASK);
    const task = stored.value;
    const workspace = yield* workspaceOf(binding.userId, task.workspaceId);
    const slug = Option.getOrUndefined(workspace)?.slug ?? task.workspaceId;
    const files = yield* readPictureFiles(pictures, sandbox);
    if (Result.isFailure(files)) return Result.fail(files.failure);
    return Result.succeed({ slug, files: files.success });
  });
}

/**
 * The pictures read kept on the plan as the binding's account, each written
 * as an added point, its picture's line under its section. Note that this
 * runs inside the call's transaction, so a refusal keeps none of them.
 */
function keptAsNotes(
  binding: DescriptionDocumentBinding,
  read: PicturesRead,
): Effect.Effect<readonly DescriptionNote[], EditRefused | StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const notes: DescriptionNote[] = [];
    for (const { picture, file } of read.files) {
      const kept = yield* keepDescriptionAttachment(binding.userId, binding.taskId, file);
      if (kept.status === DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY) {
        return yield* new EditRefused({
          refusal: refused(DESCRIPTION_EDIT_REFUSAL.TOO_MANY_PICTURES),
        });
      }
      if (kept.status === DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY_VIDEOS) {
        return yield* new EditRefused({
          refusal: refused(DESCRIPTION_EDIT_REFUSAL.TOO_MANY_VIDEOS),
        });
      }
      if (kept.status === DESCRIPTION_ATTACHMENT_KEEP.NO_TASK) {
        return yield* new EditRefused({ refusal: refused(DESCRIPTION_EDIT_REFUSAL.TASK_GONE) });
      }
      const address = descriptionAttachmentAddress(
        { taskId: binding.taskId, attachmentId: kept.id },
        read.slug,
      );
      notes.push({
        kind: NOTE_KIND.ADD,
        section: picture.section,
        text: taskPictureMarkdown(address, picture.alt, picture.caption),
      });
    }
    return notes;
  });
}

/**
 * The call's notes, and the pictures read for it kept and added after them,
 * saved in one transaction under the writer given, or the refusal the save
 * answered. Note that a refusal anywhere keeps no picture, so none holds a
 * place in the plan's bound.
 */
function savedEdit(
  binding: DescriptionDocumentBinding,
  writer: DescriptionWriter,
  notes: readonly DescriptionNote[],
  read: PicturesRead,
): Effect.Effect<DescriptionEditResult, never, DatabaseServices> {
  const saved = Effect.gen(function* () {
    const all = [...notes, ...(yield* keptAsNotes(binding, read))];
    const save = yield* saveNotes(binding, all, writer);
    if (save.status === DESCRIPTION_SAVE_STATUS.CONFLICT) {
      const refusal = {
        ...refused(DESCRIPTION_EDIT_REFUSAL.CONFLICT),
        missed: missedNote(save.missed),
        current: save.current,
      };
      return yield* new EditRefused({ refusal });
    }
    if (save.status !== DESCRIPTION_SAVE_STATUS.SAVED) {
      return yield* new EditRefused({ refusal: refused(save.reason) });
    }
    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      taken: all.length,
    } satisfies DescriptionEditResult;
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(saved)).pipe(
    Effect.catchTag("EditRefused", ({ refusal }) => Effect.succeed(refusal)),
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.UNAVAILABLE)),
    ),
  );
}

/**
 * Runs one call: the notes taken into the plan the binding names, and its
 * pictures read from the sandbox, kept, and added after them. Every file is
 * read before the store is written (`savedEdit`). Note that `takenInTurn` is
 * the caller's count of this turn's notes, because the turn's row keeps it
 * (`reserveTurnDescriptionNotes`).
 */
export function recordDescriptionEdit(
  binding: DescriptionDocumentBinding,
  author: DescriptionNoteAuthor,
  input: UnparsedWireValue,
  takenInTurn: number,
  sandbox: InboxSandboxDoor,
): Effect.Effect<DescriptionEditResult, never, DatabaseServices> {
  const notes = notesOf(input);
  const pictures = picturesOf(input);
  if (notes === undefined || pictures === undefined) {
    return Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.UNREADABLE));
  }
  if (takenInTurn + notes.length + pictures.length > DESCRIPTION_EDIT.MAX_NOTES_PER_TURN) {
    return Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.TOO_MANY));
  }
  const writer = { actor: DESCRIPTION_ACTOR.AGENT, agentId: author.agentId } as const;
  return Effect.gen(function* () {
    const read = yield* picturesInSandbox(binding, pictures, sandbox);
    if (Result.isFailure(read)) return descriptionEditRejected(read.failure);
    return yield* savedEdit(binding, writer, notes, read.success);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.UNAVAILABLE)),
    ),
  );
}

/**
 * A member's own notes, as an outside agent takes them for the member
 * through the member MCP server (`../../member-mcp/`): the same save as a
 * coding agent's, written as the developer's, as the member's own edit in the
 * window is, and with no picture, since no sandbox stands behind a member.
 * Note that no turn's count caps them, since a member takes no turn: the
 * notes' schema bounds one call's, which the server checks before it runs.
 */
export function recordMemberDescriptionNotes(
  binding: DescriptionDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<DescriptionEditResult, never, DatabaseServices> {
  const notes = notesOf(input);
  if (notes === undefined)
    return Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.UNREADABLE));
  return savedEdit(binding, { actor: DESCRIPTION_ACTOR.DEVELOPER }, notes, NO_PICTURES);
}
