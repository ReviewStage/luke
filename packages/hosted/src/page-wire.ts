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

const PAGE_BOUNDS = {
  /** The most characters a page's title may spell. */
  MAX_TITLE_CHARS: 80,
  /** The most characters one version's HTML may spell: a document with its scripts and styles inline. */
  MAX_HTML_CHARS: 256 * 1024,
} as const;

const pageTitleSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(PAGE_BOUNDS.MAX_TITLE_CHARS),
);

const pageHtmlSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(PAGE_BOUNDS.MAX_HTML_CHARS),
);

/** A version's number within its page, from one. */
export const pageVersionNumberSchema = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(1),
);

/**
 * One page as its plan lists it: its newest version's number and title, and
 * when that version was written, in epoch milliseconds. Every version from
 * one to `version` stands, so the number alone names each earlier one.
 */
const pageLineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  title: pageTitleSchema,
  version: pageVersionNumberSchema,
  at: countedNumber,
});

export type PageLine = typeof pageLineSchema.Type;

/** A plan's pages (GET `/api/plans/{id}/pages`), the most recently written first. */
export const planPagesAnswerSchema = EffectSchema.Struct({
  pages: EffectSchema.Array(pageLineSchema),
});

/** One version of a page with its HTML (GET `/api/plans/{id}/pages/{page}/versions/{version}`), titled as that version was. */
const pageVersionSchema = EffectSchema.Struct({
  ...pageLineSchema.fields,
  html: pageHtmlSchema,
});

export type PageVersion = typeof pageVersionSchema.Type;

export const planPageVersionAnswerSchema = EffectSchema.Struct({ page: pageVersionSchema });
