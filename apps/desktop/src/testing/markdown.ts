import { markdownHtmlParserAtom } from "@luke/panel/markdown-html-parser";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

/**
 * markdown.ts -- the HTML parser a reply's markdown is drawn through, landed as the panel lands it after its first paint.
 *
 * A reply is drawn only once the parser's chunk has landed
 * (`../renderer/markdown-html-parser.ts`), which the panel starts as it first
 * paints, long before a transcript opens. A test that draws one at once runs
 * this first, as the panel would have; a test of a reply drawn before the
 * parser lands leaves it out.
 */

/** Loads the parser and settles once it has landed. */
export const markdownHtmlParserLanded: Effect.Effect<void, Error> = AtomRegistry.getResult(
  rendererRegistry,
  markdownHtmlParserAtom,
).pipe(Effect.asVoid);
