import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * page-wire.ts -- a plan's pages: the interactive HTML documents an agent shows the developer, each kept as its versions.
 *
 * A page is one self-contained HTML document an agent wrote for a plan, under
 * a title. Writing the same page again makes its next version rather than a
 * second page, and every version stands as it was written, so an earlier one
 * reads exactly as it was shown. Versions count from one within their page.
 *
 * The service answers a page's HTML inside JSON and never as a document of
 * its own origin, so nothing an agent wrote ever runs as tryluke.dev; the Mac
 * draws it in a sandboxed frame of its own scheme.
 */

/** The tool every agent writes a page with, by the name its calls carry. */
export const SHOW_PAGE_TOOL_NAME = "show_page";

export const PAGE_BOUNDS = {
  /** The most characters a page's title may spell. */
  MAX_TITLE_CHARS: 80,
  /** The most characters one version's HTML may spell: a document with its scripts and styles inline. */
  MAX_HTML_CHARS: 256 * 1024,
} as const;

export const pageTitleSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(PAGE_BOUNDS.MAX_TITLE_CHARS),
);

export const pageHtmlSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(PAGE_BOUNDS.MAX_HTML_CHARS),
);

/** A version's number within its page, from one. */
export const pageVersionNumberSchema = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(1),
);

/**
 * What an agent writes of a page: its title and whole HTML, as the next
 * version of the page it names, or as a new page's first where it names none.
 */
export const pageWriteSchema = EffectSchema.Struct({
  pageId: EffectSchema.optionalKey(wireUuidSchema),
  title: pageTitleSchema,
  html: pageHtmlSchema,
});

export type PageWrite = typeof pageWriteSchema.Type;

/** Who showed a version of a page: Luke, from a call, or one of the plan's coding agents. */
export const PAGE_SHOWER = {
  LUKE: "luke",
  AGENT: "agent",
} as const;

/**
 * Who showed a version of a page: Luke, or a coding agent by its id alone,
 * so whoever reads it names the agent by what its row says now, as a plan's
 * agent edits are named (`plan-template.ts`'s `planAgentEditSchema`).
 */
export const pageShowerSchema = EffectSchema.Union([
  EffectSchema.Struct({ kind: EffectSchema.Literal(PAGE_SHOWER.LUKE) }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(PAGE_SHOWER.AGENT), agentId: wireUuidSchema }),
]);

export type PageShower = typeof pageShowerSchema.Type;

/**
 * One page as its plan lists it: its newest version's number and title,
 * when that version was written, in epoch milliseconds, and who showed it.
 * Every version from one to `version` stands, so the number alone names
 * each earlier one.
 */
export const pageLineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  title: pageTitleSchema,
  version: pageVersionNumberSchema,
  at: countedNumber,
  /** Who showed this version; absent for one shown before who showed it was kept, and from a service older than it. */
  shownBy: EffectSchema.optionalKey(pageShowerSchema),
});

export type PageLine = typeof pageLineSchema.Type;

/** A plan's pages (GET `/api/plans/{id}/pages`), the most recently written first. */
export const taskPagesAnswerSchema = EffectSchema.Struct({
  pages: EffectSchema.Array(pageLineSchema),
});

/** One version of a page with its HTML (GET `/api/plans/{id}/pages/{page}/versions/{version}`), titled as that version was. */
const pageVersionSchema = EffectSchema.Struct({
  ...pageLineSchema.fields,
  html: pageHtmlSchema,
});

export type PageVersion = typeof pageVersionSchema.Type;

export const planPageVersionAnswerSchema = EffectSchema.Struct({ page: pageVersionSchema });
