import type { DatabaseServices } from "@repo/database/core/query";
import {
  keepDescriptionAttachment,
  DESCRIPTION_ATTACHMENT_KEEP,
} from "@repo/database/models/description-attachments";
import type { DescriptionWriter } from "@repo/database/models/description-revisions";
import { readTaskHeader } from "@repo/database/models/task-store";
import { workspaceOf } from "@repo/database/models/workspace-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { PICTURE_BOUNDS, type Picture } from "@repo/features/picture-wire";
import {
  descriptionAttachmentAddress,
  taskPictureMarkdown,
} from "@repo/features/description-attachment-link";
import { DESCRIPTION_ATTACHMENT_BOUNDS } from "@repo/features/description-attachment-wire";
import {
  NOTE_KIND,
  type DescriptionNote,
  descriptionNoteSectionSchema,
  descriptionNotesSchema,
  readNotes,
} from "@repo/features/description-notes";
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

const DESCRIPTION_EDIT = {
  MAX_NOTES_PER_TURN: 40,
  MAX_PICTURES_PER_CALL: 4,
  MAX_PATH_CHARS: 1_024,
  MAX_ALT_CHARS: 300,
  MAX_CAPTION_CHARS: 200,
} as const;

function trimmedText(maximumChars: number) {
  return Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(maximumChars));
}

const pictureSchema = Schema.Struct({
  section: descriptionNoteSectionSchema,
  path: describeWire(
    trimmedText(DESCRIPTION_EDIT.MAX_PATH_CHARS),
    "The picture's file in your sandbox, such as a screenshot you took or a recording you made of " +
      `a flow, relative to your working folder or absolute: a PNG, JPEG, or WebP of at most ${PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB, ` +
      `or a WebM video of at most ${PICTURE_BOUNDS.MAX_VIDEO_BYTES / 1_000_000} MB, which the description plays.`,
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

const readEditedTask = readEither(editedTaskSchema, { excess: EXCESS_KEYS.DROP });

const EDIT_DESCRIPTION_INPUT = Schema.Struct({
  taskId: describeWire(
    wireUuidSchema,
    `The task whose description to edit, your own or another of your workspace, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  ),
  ...descriptionNotesSchema.fields,
  pictures: Schema.optionalKey(
    describeWire(
      picturesSchema,
      "Pictures to add, each at the end of its section, after the notes are taken.",
    ),
  ),
});

export const EDIT_DESCRIPTION_TOOL = {
  name: "edit_description",
  description:
    "Take notes on the description of the task taskId names, your own task or any other of your " +
    `workspace, which ${AGENT_TOOL.READ_TASK} reads first, as its notetaker does: add a point ` +
    "under one of its headings, or replace text copied exactly from the saved description, as much as " +
    "names one place, headings and whole sections included, with what it becomes, or with " +
    "nothing to delete it. A note's text may open headings of its own, so you can rename, " +
    "split, merge, move, and drop sections. Use it to record a question the description does not answer under its open " +
    "questions together with the assumption you go on under, to correct a fact you verified in " +
    "the code, to record a hard part you met, an interface you had to change, or a decision you " +
    "made, each under the heading it belongs to. Write a file, a pull request, or an issue a note names as a mention, " +
    "a Markdown link to its page whose words start with @, such as [@store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), so the description draws it as a chip. " +
    "To add a picture, such as a screenshot of what you built, name its file in your sandbox " +
    "under pictures, with alt text saying what it shows. " +
    "Every save is recorded in the description as yours. The developer reads the description when they next " +
    `open it in ${PRODUCT_NAME}; you do not wait for an answer. A call's notes and pictures land together ` +
    "or not at all: where one names text or a heading the description does not hold exactly once, " +
    "nothing is saved and the call answers the description as it stands, to retry from. " +
    `A turn may take at most ${DESCRIPTION_EDIT.MAX_NOTES_PER_TURN} notes, each picture one.`,
  inputSchema: EDIT_DESCRIPTION_INPUT,
} as const;

export const DESCRIPTION_EDIT_REFUSAL = {
  UNREADABLE: "Not saved: the notes do not read under the notes' schema.",
  TOO_MANY: `Not saved: a turn may take at most ${DESCRIPTION_EDIT.MAX_NOTES_PER_TURN} notes on the description. Go on, and name what you would have noted in your message.`,
  UNAVAILABLE: "Not saved: the service could not reach its store.",
  OFF: "Not saved: your developer has Task descriptions off, so no description is written. Say in your message what you would have noted.",
  NO_TASK_NAMED: `Not saved: name the task whose description to edit as taskId, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  NO_TASK: `Not saved: no task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
  NO_TURN:
    "Not saved: your turn is not recorded yet, so its notes cannot be counted. Try again in a moment.",
  TOO_MANY_PICTURES: `Not saved: the description holds ${DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION} pictures, as many as a description may. Leave the pictures out.`,
  TOO_MANY_VIDEOS: `Not saved: the description holds ${DESCRIPTION_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_DESCRIPTION} videos, as many as a description may. Leave the videos out, or show them with show_image instead.`,
  TASK_GONE:
    "Not saved: this task no longer exists, so no picture can be added to its description.",
  CONFLICT:
    "Not saved: none of this call's notes was taken, because one names what the description does not hold exactly once. The description as it stands is in current; retry from it.",
} as const;

const MISSED_FIND_CHARS = 200;

export const TASK_PICTURE_FILE_REFUSAL = {
  NO_FILE: "Not saved: a picture names no file in your sandbox:",
  NOT_IMAGE:
    "Not saved: a picture names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size:",
  TOO_LARGE: `Not saved: a picture names an image larger than ${PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB, or a video larger than ${PICTURE_BOUNDS.MAX_VIDEO_BYTES / 1_000_000} MB; take it smaller, or at one screen scale, or record a shorter flow:`,
  UNREADABLE: "Not saved: a picture's file could not be read from your sandbox:",
} as const;
export interface NotesTaken {
  readonly turnId?: string;
  readonly count: number;
}

export const NO_NOTES_TAKEN: NotesTaken = { count: 0 };

export function takenInTurn(taken: NotesTaken, turnId: string): number {
  return taken.turnId === turnId ? taken.count : 0;
}

export function reserveNotes(taken: NotesTaken, turnId: string, requested: number): NotesTaken {
  return { turnId, count: takenInTurn(taken, turnId) + requested };
}

export function settleNotes(
  taken: NotesTaken,
  turnId: string,
  requested: number,
  saved: number,
): NotesTaken {
  return { turnId, count: Math.max(0, takenInTurn(taken, turnId) - requested + saved) };
}

export function editedTaskOf(input: UnparsedWireValue): string | undefined {
  const read = readEditedTask(input);
  return Result.isSuccess(read) ? read.success.taskId : undefined;
}

function notesOf(input: UnparsedWireValue): readonly DescriptionNote[] | undefined {
  if (!isRecord(input) || !Array.isArray(input.notes)) return undefined;
  const { notes, unread } = readNotes(input);
  return unread > 0 ? undefined : notes;
}

function picturesOf(input: UnparsedWireValue): readonly TaskPicture[] | undefined {
  if (!isRecord(input)) return undefined;
  if (input.pictures === undefined) return [];
  const read = readPictures(input.pictures);
  return Result.isSuccess(read) ? read.success : undefined;
}

export function requestedNotes(input: UnparsedWireValue): number {
  return (notesOf(input)?.length ?? 0) + (picturesOf(input)?.length ?? 0);
}

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

function missedNote(note: DescriptionNote): string {
  if (note.kind === NOTE_KIND.ADD) return `${note.kind} under ${note.section}`;
  const find =
    note.find.length > MISSED_FIND_CHARS ? `${note.find.slice(0, MISSED_FIND_CHARS)}…` : note.find;
  return `${note.kind} ${find}`;
}

interface PictureRead {
  readonly picture: TaskPicture;
  readonly file: Picture;
}

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

interface PicturesRead {
  readonly slug: string;
  readonly files: readonly PictureRead[];
}

const NO_PICTURES: PicturesRead = { slug: "", files: [] };

class EditRefused extends Data.TaggedError("EditRefused")<{
  readonly refusal: Extract<
    DescriptionEditResult,
    { status: typeof ACTION_RESULT_STATUS.REJECTED }
  >;
}> {}

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

export function recordMemberDescriptionNotes(
  binding: DescriptionDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<DescriptionEditResult, never, DatabaseServices> {
  const notes = notesOf(input);
  if (notes === undefined)
    return Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.UNREADABLE));
  return savedEdit(binding, { actor: DESCRIPTION_ACTOR.DEVELOPER }, notes, NO_PICTURES);
}
