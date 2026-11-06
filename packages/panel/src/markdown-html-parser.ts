import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type * as RehypeRaw from "rehype-raw";
import { rendererRegistry, rendererRuntime } from "./renderer-runtime.js";

let parser: typeof RehypeRaw.default | undefined;

const rehypeRaw: typeof RehypeRaw.default = (options) => (tree, file) =>
  parser === undefined ? tree : parser(options)(tree, file);

export default rehypeRaw;

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

export function prefetchMarkdownHtmlParser(): void {
  rendererRegistry.get(markdownHtmlParserAtom);
}
