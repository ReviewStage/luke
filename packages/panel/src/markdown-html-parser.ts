import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type * as RehypeRaw from "rehype-raw";

/**
 * markdown-html-parser.ts -- the HTML parser a reply's markdown is drawn through (`rehype-raw`), kept out of the bundle every window parses and loaded once per window as the panel first paints.
 *
 * Streamdown runs every reply through `rehype-raw`, which hands the whole
 * tree to parse5, an HTML parser of some 50 KB gzipped, which the window
 * would otherwise parse before its first paint. So the build answers Streamdown's
 * `import "rehype-raw"` with this module (`scripts/build-table.mjs`'s
 * `redirectOf`, and the same in `vitest.config.ts`), and
 * this module reaches the library through a dynamic `import()`, which the
 * build splits into a chunk of its own.
 *
 * The parser is not only for raw HTML: it parses every tree again, and that
 * moves bytes in words that hold none, the line breaks between a table's
 * rows among them. So a reply is never drawn without it. `MessageResponse`
 * draws nothing until it has landed, which, started after the panel's first
 * paint, is long before a transcript opens. The load is read through
 * TanStack Query (`markdownHtmlParserQuery`), as an import is async data:
 * kept for the window's life once it settles, and asked for by whatever
 * reads it first.
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

/**
 * The parser's chunk, imported once per window and kept for its life. Note
 * that a failure answers as a landing does, never tried again, so a reply
 * is drawn as the words it can be rather than never.
 */
export const markdownHtmlParserQuery = queryOptions({
  queryKey: ["markdown-html-parser"] as const,
  queryFn: () =>
    import("rehype-raw").then(
      (module) => {
        parser = module.default;
        return true;
      },
      () => false,
    ),
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
  retry: false,
});

/** Starts the parser loading, where it has not started already. */
export function usePrefetchMarkdownHtmlParser(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.prefetchQuery(markdownHtmlParserQuery);
  }, [client]);
}
