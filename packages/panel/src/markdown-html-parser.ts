import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type * as RehypeRaw from "rehype-raw";
import { rendererRegistry, rendererRuntime } from "./renderer-runtime.js";

/**
 * markdown-html-parser.ts -- the HTML parser a reply's markdown is drawn through (`rehype-raw`), kept out of the bundle every window parses and loaded once per window as the panel first paints.
 *
 * Streamdown runs every reply through `rehype-raw`, which hands the whole
 * tree to parse5, an HTML parser of some 50 KB gzipped, and the voice and
 * call windows, which draw no markdown, would parse it for nothing. So the build answers Streamdown's
 * `import "rehype-raw"` with this module (`scripts/build.mjs`'s
 * `markdownHtmlParserOnDemand`, and the same in `vitest.config.ts`), and
 * this module reaches the library through a dynamic `import()`, which the
 * build splits into a chunk of its own.
 *
 * The parser is not only for raw HTML: it parses every tree again, and that
 * moves bytes in words that hold none, the line breaks between a table's
 * rows among them. So a reply is never drawn without it. `MessageResponse`
 * draws nothing until it has landed, which, started after the panel's first
 * paint, is long before a transcript opens.
 */

/** The library itself, once its chunk has landed. */
let parser: typeof RehypeRaw.default | undefined;

/**
 * Stands where Streamdown imports `rehype-raw`, and is the library's own
 * transform once the parser has landed. Note that the parser is read as each
 * tree is drawn rather than as the plugin is attached, because Streamdown
 * keeps a processor once built for every reply after it. Before it lands the
 * tree passes untouched; nothing draws one then but a reply whose parser
 * failed to load, which is drawn as the words it can be.
 */
const rehypeRaw: typeof RehypeRaw.default = (options) => (tree, file) =>
  parser === undefined ? tree : parser(options)(tree, file);

export default rehypeRaw;

/** The parser's chunk, loaded once per window and kept for its life. */
export const markdownHtmlParserAtom = Atom.keepAlive(
  rendererRuntime.atom(
    Effect.suspend(() =>
      parser !== undefined
        ? Effect.void
        : Effect.tryPromise({
            try: () => import("rehype-raw"),
            catch: () => new Error("The markdown parser could not be loaded."),
          }).pipe(
            Effect.andThen((module) =>
              Effect.sync(() => {
                parser = module.default;
              }),
            ),
          ),
    ),
  ),
);

/** Starts the parser loading, where it has not started already. */
export function prefetchMarkdownHtmlParser(): void {
  rendererRegistry.get(markdownHtmlParserAtom);
}
