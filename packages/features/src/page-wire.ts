import { LEGACY_APP_WORD, literalsReadingLegacy } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

export const SHOW_PAGE_TOOL_NAME = "show_page";

export const PAGE_BOUNDS = {
  MAX_TITLE_CHARS: 80,
  MAX_HTML_CHARS: 1024 * 1024,
} as const;

export const pageTitleSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(PAGE_BOUNDS.MAX_TITLE_CHARS),
);

const pageHtmlSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(PAGE_BOUNDS.MAX_HTML_CHARS),
);

export const pageVersionNumberSchema = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(1),
);

export const pageWriteSchema = EffectSchema.Struct({
  pageId: EffectSchema.optionalKey(wireUuidSchema),
  title: pageTitleSchema,
  html: pageHtmlSchema,
});

export type PageWrite = typeof pageWriteSchema.Type;

export const PAGE_SHOWER = {
  APP: "app",
  AGENT: "agent",
} as const;

export const pageShowerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: literalsReadingLegacy([PAGE_SHOWER.APP], LEGACY_APP_WORD, PAGE_SHOWER.APP),
  }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(PAGE_SHOWER.AGENT), agentId: wireUuidSchema }),
]);

export type PageShower = typeof pageShowerSchema.Type;

export const pageLineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  title: pageTitleSchema,
  version: pageVersionNumberSchema,
  at: countedNumber,
  shownBy: EffectSchema.optionalKey(pageShowerSchema),
});

export type PageLine = typeof pageLineSchema.Type;

export const taskPagesAnswerSchema = EffectSchema.Struct({
  pages: EffectSchema.Array(pageLineSchema),
});

const pageVersionSchema = EffectSchema.Struct({
  ...pageLineSchema.fields,
  html: pageHtmlSchema,
});

export type PageVersion = typeof pageVersionSchema.Type;

export const taskPageVersionAnswerSchema = EffectSchema.Struct({ page: pageVersionSchema });

export const PAGE_OWNER = {
  TASK: "task",
  AGENT: "agent",
} as const;

export type PageOwner =
  | { readonly kind: typeof PAGE_OWNER.TASK; readonly taskId: string }
  | { readonly kind: typeof PAGE_OWNER.AGENT; readonly agentId: string };

export function taskPageOwner(taskId: string): PageOwner {
  return { kind: PAGE_OWNER.TASK, taskId };
}

export const pagePlaceSchema = EffectSchema.Union([
  EffectSchema.Struct({ taskId: EffectSchema.NonEmptyString }),
  EffectSchema.Struct({ agentId: EffectSchema.NonEmptyString }),
]);

export type PagePlace = typeof pagePlaceSchema.Type;

export function pagePlaceId(place: PagePlace): string {
  return "taskId" in place ? place.taskId : place.agentId;
}
