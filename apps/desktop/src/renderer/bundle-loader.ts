import { Effect } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { rendererRuntime } from "./renderer-runtime";

/**
 * bundle-loader.ts -- a bundle of the panel's own that is too large for the one every window parses, loaded the first time it is needed and kept for the window's life.
 *
 * The whiteboard (`whiteboard/`), a File tab's tree (`file-tree/`), the panel's
 * editors (`plan-editor/`), a Terminal tab's screen (`terminal/`), the
 * session recorder (`session-recorder/`), and a plan's diagrams (`diagram/`)
 * each ship as a script of their own beside `index.html` that sets one global
 * once it has run; the diagrams' is an ES module, whose chunks it imports
 * as it needs them. Loading one adds its stylesheet, where it has one, and
 * its script to the document, and answers with what the script set; the
 * answer is kept alive, so leaving the surface and coming back loads
 * nothing.
 */

/** A bundle's files beside `index.html`: its script, whether that script is an ES module, and its stylesheet where it has one. */
export interface BundleAsset {
  readonly script: string;
  readonly module?: boolean;
  readonly stylesheet?: string;
}

/**
 * Adds a bundle's stylesheet, where it has one, and its script to the
 * document, and calls back once the script has run or failed. The one way a
 * bundle of the panel's own reaches the page, for the atom below and for the
 * session recorder (`session-replay.ts`), which no atom drives.
 */
export function appendBundle(asset: BundleAsset, onLoad: () => void, onError: () => void): void {
  const script = document.createElement("script");
  script.src = asset.script;
  if (asset.module === true) script.type = "module";
  script.addEventListener("load", onLoad);
  script.addEventListener("error", onError);
  if (asset.stylesheet === undefined) {
    document.head.append(script);
    return;
  }
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = asset.stylesheet;
  document.head.append(stylesheet, script);
}

/** The bundle loaded once per window, as what its script set on `window`, or the failure given. */
export function bundleAtom<A>(
  asset: BundleAsset,
  loaded: () => A | undefined,
  failure: string,
): Atom.Atom<AsyncResult.AsyncResult<A, Error>> {
  return Atom.keepAlive(
    rendererRuntime.atom(
      Effect.callback<A, Error>((resume) => {
        const standing = loaded();
        if (standing !== undefined) {
          resume(Effect.succeed(standing));
          return;
        }
        appendBundle(
          asset,
          () => {
            const module = loaded();
            resume(module ? Effect.succeed(module) : Effect.fail(new Error(failure)));
          },
          () => resume(Effect.fail(new Error(failure))),
        );
      }),
    ),
  );
}
