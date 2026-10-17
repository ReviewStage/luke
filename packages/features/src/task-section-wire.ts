import { Schema as EffectSchema } from "effect";
import { pinPositionSchema } from "./pin-order.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * task-section-wire.ts -- the sections an account made in a workspace's sidebar to keep its tasks in, as the Mac and the service read them.
 *
 * A section is its maker's own reading of their work, as a pin is: one
 * account's, in one workspace, so a teammate's sidebar never wears it. It
 * has a title and, optionally, an icon, one emoji or one of the glyphs
 * named here, and a place among the account's sections once dragged there
 * (`pin-order.ts`'s keys; with none, it stands by when it was made). A task
 * stands in at most one of the account's sections, an entry with a place
 * of its own among the section's tasks. Deleting a section deletes its
 * entries and none of its tasks, which go back under Tasks.
 *
 * Every write is one request to `PUT /api/task-sections`, and every answer,
 * the read's and each write's alike, is the whole of the account's sections
 * and entries as they then stand, so the window draws the service's word
 * rather than its guess. A section is made under an id its maker chose, so
 * the window can draw it, and move a task into it, before the service
 * answers, and a create asked twice makes one section.
 */

export const TASK_SECTION_BOUNDS = {
  /** The most characters a section's title may spell. */
  MAX_TITLE_CHARS: 60,
  /** The most sections one account may keep across its workspaces; a section past it is refused, and nothing is written. */
  MAX_SECTIONS: 100,
  /** The most UTF-16 units one emoji may spell, a family or a flag with its joiners included. */
  MAX_EMOJI_UNITS: 32,
} as const;

/** What a section's icon is: one emoji, or one of Luke's own glyphs. */
export const TASK_SECTION_ICON_KIND = {
  EMOJI: "emoji",
  GLYPH: "glyph",
} as const;

/** The glyphs a section may wear, each a Lucide icon the Mac draws by this name. */
export const TASK_SECTION_GLYPH = {
  FOLDER: "folder",
  STAR: "star",
  BOOKMARK: "bookmark",
  FLAG: "flag",
  ROCKET: "rocket",
  ZAP: "zap",
  BUG: "bug",
  FLASK: "flask",
  BRIEFCASE: "briefcase",
  LAYERS: "layers",
  HEART: "heart",
  CIRCLE: "circle",
} as const;

export type TaskSectionGlyph = (typeof TASK_SECTION_GLYPH)[keyof typeof TASK_SECTION_GLYPH];

/** Which write a request is. */
export const TASK_SECTION_WRITE = {
  CREATE: "create",
  EDIT: "edit",
  MOVE: "move",
  DELETE: "delete",
  PLACE: "place",
} as const;

/** What reads as an emoji: a pictograph, a flag's letters, or a keycap. */
const EMOJI_PART = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

/** Whether a text is one grapheme, an emoji's, as a person sees one character. */
function isOneEmoji(text: string): boolean {
  if (!EMOJI_PART.test(text)) return false;
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  return [...graphemes].length === 1;
}

/** One emoji, its ends trimmed. */
const emojiSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(TASK_SECTION_BOUNDS.MAX_EMOJI_UNITS),
  EffectSchema.makeFilter(isOneEmoji),
);

/** A section's icon: one emoji, or one of the glyphs `TASK_SECTION_GLYPH` names. */
export const taskSectionIconSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_ICON_KIND.EMOJI),
    emoji: emojiSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_ICON_KIND.GLYPH),
    glyph: EffectSchema.Literals(Object.values(TASK_SECTION_GLYPH)),
  }),
]);

export type TaskSectionIcon = typeof taskSectionIconSchema.Type;

/** A section's title: its ends trimmed, never blank, and bounded. */
const titleSchema = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(TASK_SECTION_BOUNDS.MAX_TITLE_CHARS),
);

/** One of the account's sections, in the workspace it was made in. */
export const taskSectionSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  workspaceId: workspaceIdSchema,
  title: titleSchema,
  icon: EffectSchema.optionalKey(taskSectionIconSchema),
  /** Where it stands among the account's sections once dragged there; absent while it stands by `createdAt`. */
  position: EffectSchema.optionalKey(pinPositionSchema),
  /** Epoch milliseconds it was made. */
  createdAt: countedNumber,
});

export type TaskSection = typeof taskSectionSchema.Type;

/** A task the account keeps in one of its sections. */
export const taskSectionEntrySchema = EffectSchema.Struct({
  taskId: wireUuidSchema,
  sectionId: wireUuidSchema,
  /** Where it stands among the section's tasks once dragged there; absent while it stands by `addedAt`. */
  position: EffectSchema.optionalKey(pinPositionSchema),
  /** Epoch milliseconds it was put in the section. */
  addedAt: countedNumber,
});

export type TaskSectionEntry = typeof taskSectionEntrySchema.Type;

/** The account's sections and the tasks in them (GET, and every PUT's answer). */
export const taskSectionsAnswerSchema = EffectSchema.Struct({
  sections: EffectSchema.Array(taskSectionSchema),
  entries: EffectSchema.Array(taskSectionEntrySchema),
});

export type TaskSections = typeof taskSectionsAnswerSchema.Type;

/**
 * One write (PUT): make a section under the id given, in a workspace the
 * account is a member of; give one a new title and icon, null for none;
 * stand one at a place among the others; delete one, which puts its tasks
 * back under Tasks; or put a task in a section at a place, or, under null,
 * in none.
 */
export const taskSectionWriteSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_WRITE.CREATE),
    id: wireUuidSchema,
    workspaceId: workspaceIdSchema,
    title: titleSchema,
    icon: EffectSchema.optionalKey(taskSectionIconSchema),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_WRITE.EDIT),
    id: wireUuidSchema,
    title: titleSchema,
    icon: EffectSchema.NullOr(taskSectionIconSchema),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_WRITE.MOVE),
    id: wireUuidSchema,
    position: pinPositionSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_WRITE.DELETE),
    id: wireUuidSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_WRITE.PLACE),
    taskId: wireUuidSchema,
    sectionId: EffectSchema.NullOr(wireUuidSchema),
    position: EffectSchema.optionalKey(pinPositionSchema),
  }),
]);

export type TaskSectionWrite = typeof taskSectionWriteSchema.Type;
