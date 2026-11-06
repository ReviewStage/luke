import { Schema as EffectSchema } from "effect";
import { pinPositionSchema } from "./pin-order.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

export const TASK_SECTION_BOUNDS = {
  MAX_TITLE_CHARS: 60,
  MAX_SECTIONS: 100,
  MAX_EMOJI_UNITS: 32,
  MAX_GLYPH_CHARS: 64,
} as const;

export const TASK_SECTION_ICON_KIND = {
  EMOJI: "emoji",
  GLYPH: "glyph",
} as const;

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

export const TASK_SECTION_ICON_COLOR = {
  RED: "red",
  ORANGE: "orange",
  YELLOW: "yellow",
  GREEN: "green",
  TEAL: "teal",
  BLUE: "blue",
  PURPLE: "purple",
  PINK: "pink",
} as const;

export type TaskSectionIconColor =
  (typeof TASK_SECTION_ICON_COLOR)[keyof typeof TASK_SECTION_ICON_COLOR];

export const TASK_SECTION_WRITE = {
  CREATE: "create",
  EDIT: "edit",
  MOVE: "move",
  DELETE: "delete",
  PLACE: "place",
  PLACE_AGENT: "place-agent",
} as const;

const EMOJI_PART = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

function isOneEmoji(text: string): boolean {
  if (!EMOJI_PART.test(text)) return false;
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  return [...graphemes].length === 1;
}

export const taskSectionEmojiSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(TASK_SECTION_BOUNDS.MAX_EMOJI_UNITS),
  EffectSchema.makeFilter(isOneEmoji),
);

const glyphSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(TASK_SECTION_BOUNDS.MAX_GLYPH_CHARS),
  EffectSchema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
);

export const taskSectionIconSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_ICON_KIND.EMOJI),
    emoji: taskSectionEmojiSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_ICON_KIND.GLYPH),
    glyph: glyphSchema,
    color: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(TASK_SECTION_ICON_COLOR))),
  }),
]);

export type TaskSectionIcon = typeof taskSectionIconSchema.Type;

export const taskSectionTitleSchema = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(TASK_SECTION_BOUNDS.MAX_TITLE_CHARS),
);

export const taskSectionSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  workspaceId: workspaceIdSchema,
  title: taskSectionTitleSchema,
  icon: EffectSchema.optionalKey(taskSectionIconSchema),
  position: EffectSchema.optionalKey(pinPositionSchema),
  createdAt: countedNumber,
});

export type TaskSection = typeof taskSectionSchema.Type;

export const taskSectionEntrySchema = EffectSchema.Struct({
  taskId: wireUuidSchema,
  sectionId: wireUuidSchema,
  position: EffectSchema.optionalKey(pinPositionSchema),
  addedAt: countedNumber,
});

export type TaskSectionEntry = typeof taskSectionEntrySchema.Type;

export const agentSectionEntrySchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  sectionId: wireUuidSchema,
  position: EffectSchema.optionalKey(pinPositionSchema),
  addedAt: countedNumber,
});

export type AgentSectionEntry = typeof agentSectionEntrySchema.Type;

export const taskSectionsAnswerSchema = EffectSchema.Struct({
  sections: EffectSchema.Array(taskSectionSchema),
  entries: EffectSchema.Array(taskSectionEntrySchema),
  agentEntries: EffectSchema.Array(agentSectionEntrySchema),
});

export type TaskSections = typeof taskSectionsAnswerSchema.Type;

export const taskSectionsWrittenSchema = EffectSchema.Struct({
  ...taskSectionsAnswerSchema.fields,
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export type TaskSectionsWritten = typeof taskSectionsWrittenSchema.Type;

export const taskSectionWriteSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_WRITE.CREATE),
    id: wireUuidSchema,
    workspaceId: workspaceIdSchema,
    title: taskSectionTitleSchema,
    icon: EffectSchema.optionalKey(taskSectionIconSchema),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_WRITE.EDIT),
    id: wireUuidSchema,
    title: taskSectionTitleSchema,
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
  EffectSchema.Struct({
    kind: EffectSchema.Literal(TASK_SECTION_WRITE.PLACE_AGENT),
    agentId: wireUuidSchema,
    sectionId: EffectSchema.NullOr(wireUuidSchema),
    position: EffectSchema.optionalKey(pinPositionSchema),
  }),
]);

export type TaskSectionWrite = typeof taskSectionWriteSchema.Type;
