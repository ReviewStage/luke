import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { DiagramModule } from "@luke/ui/diagram-contract";
import { Effect } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { createContext, useCallback, useContext } from "react";
import type { DiffViewModule } from "./diff-view/contract.js";
import type { FactorySceneModule } from "./factory-world/contract.js";
import type { WorldEntry } from "./factory-world/registry.js";
import type { WorldModule } from "./factory-world/world.js";
import type { FileTreeModule } from "./file-tree/contract.js";
import type { PlanEditorModule } from "./plan-editor/contract.js";
import { rendererRuntime } from "./renderer-runtime.js";
import { shellBundles } from "./shell-bundles.js";
import type { TerminalModule } from "./terminal/contract.js";
import type { WhiteboardModule } from "./whiteboard/contract.js";

/**
 * bundle-loader.ts -- the bundles of the panel's own that are too large for the one every window parses, each imported the first time it is needed and kept for the window's life.
 *
 * The panel's editors (`plan-editor/`), the whiteboard (`whiteboard/`), a File
 * tab's tree (`file-tree/`), a Terminal tab's screen (`terminal/`), a plan's
 * diagrams (`diagram/`), and a Files changed diff (`diff-view/`) are each
 * reached through a dynamic `import()` of their entry, which the bundler splits off the bundle every window parses
 * and loads from wherever it put it, so nothing here names a file. Where a
 * bundle has a stylesheet, its entry imports it. The answer is kept alive,
 * so leaving the surface and coming back loads nothing. The Factory's scene
 * host is the shell's to reach, and the shell hands it in through a
 * `SideBundlesContext` of its own; each of the Factory's worlds, and a call's
 * avatar, are imported through what it installed (`shell-bundles.ts`).
 *
 * A surface reads its bundle through `useSideBundles`, whose atoms are built
 * over `SIDE_BUNDLE_IMPORTERS` unless a `SideBundlesContext` above it hands
 * others, as a test does to stand a bundle in or to have one fail. A call's
 * avatar, read outside any surface, is `avatarSessionAtom` alone.
 */

/** How a bundle is reached: its entry imported, answering the module it exports. */
export type BundleImporter<A> = () => Promise<A>;

/** How each bundle of the panel's own is reached. */
export interface SideBundleImporters {
  readonly planEditor: BundleImporter<PlanEditorModule>;
  readonly whiteboard: BundleImporter<WhiteboardModule>;
  readonly fileTree: BundleImporter<FileTreeModule>;
  readonly terminal: BundleImporter<TerminalModule>;
  readonly diagram: BundleImporter<DiagramModule>;
  readonly diffView: BundleImporter<DiffViewModule>;
  readonly factoryScene: BundleImporter<FactorySceneModule>;
}

/** Each bundle of the panel's own, as the module its entry exports once imported, or why it could not be. */
export type SideBundles = {
  readonly [Bundle in keyof SideBundleImporters]: Atom.Atom<
    AsyncResult.AsyncResult<Awaited<ReturnType<SideBundleImporters[Bundle]>>, Error>
  >;
};

/** What the whiteboard says where its bundle failed to load. */
export const BOARD_LOAD_FAILED = "The board could not be opened.";

/** What a File tab's tree and breadcrumbs say where their bundle failed to load; a type icon keeps its placeholder. */
export const TREE_LOAD_FAILED = "The files could not be shown.";

/** What a Terminal tab says where its bundle failed to load. */
export const TERMINAL_LOAD_FAILED = "The terminal could not be shown.";

/** What the Files changed view says where its bundle failed to load. */
export const DIFF_LOAD_FAILED = "The diff could not be shown.";

/** What the Factory says where its scene, or the world chosen, failed to load. */
export const WORLD_LOAD_FAILED = "The world could not be shown.";

/** What a fence says over its code where the diagram bundle failed to load, as it says where Mermaid refused the code. */
export const DIAGRAM_REFUSED_LINE = "This diagram could not be drawn.";

/** Why each bundle could not be had, where its import failed. */
const LOAD_FAILED = {
  planEditor: "The editor could not be loaded.",
  whiteboard: BOARD_LOAD_FAILED,
  fileTree: TREE_LOAD_FAILED,
  terminal: TERMINAL_LOAD_FAILED,
  diagram: DIAGRAM_REFUSED_LINE,
  diffView: DIFF_LOAD_FAILED,
  factoryScene: WORLD_LOAD_FAILED,
} as const satisfies { readonly [Bundle in keyof SideBundleImporters]: string };

/** Each bundle's entry, imported where the bundler put it. */
const SIDE_BUNDLE_IMPORTERS: SideBundleImporters = {
  planEditor: () => import("./plan-editor/index.js").then((entry) => entry.planEditor),
  // Note that Excalidraw is told where its fonts are before any of it runs.
  whiteboard: () =>
    import("./whiteboard/asset-path.js")
      .then(() => import("./whiteboard/index.js"))
      .then((entry) => entry.whiteboard),
  fileTree: () => import("./file-tree/index.js").then((entry) => entry.fileTree),
  terminal: () => import("./terminal/index.js").then((entry) => entry.terminal),
  diagram: () => import("./diagram/index.js").then((entry) => entry.diagram),
  diffView: () => import("./diff-view/index.js").then((entry) => entry.diffView),
  // Note that the Factory's scene is the shell's to hand in through `SideBundlesContext`.
  factoryScene: () => Promise.reject(new Error("This window draws no Factory scene.")),
};

/**
 * A bundle imported the first time it is read, as the module its entry
 * exports, or the failure given. Note that the module is kept by the atom
 * itself as well as by the registry reading it, so a bundle imported once is
 * had at once by every later reader, as a script that has run is.
 */
function bundleAtom<A>(
  importer: BundleImporter<A>,
  failure: string,
): Atom.Atom<AsyncResult.AsyncResult<A, Error>> {
  let landed: { readonly module: A } | undefined;
  const imported = Effect.tryPromise({ try: importer, catch: () => new Error(failure) }).pipe(
    Effect.tap((module) =>
      Effect.sync(() => {
        landed = { module };
      }),
    ),
  );
  return Atom.keepAlive(
    rendererRuntime.atom(
      Effect.suspend(() => (landed === undefined ? imported : Effect.succeed(landed.module))),
    ),
  );
}

/** The bundles, each imported through the importer given and the rest through their own entries. */
export function sideBundles(importers: Partial<SideBundleImporters> = {}): SideBundles {
  const reach: SideBundleImporters = { ...SIDE_BUNDLE_IMPORTERS, ...importers };
  return {
    planEditor: bundleAtom(reach.planEditor, LOAD_FAILED.planEditor),
    whiteboard: bundleAtom(reach.whiteboard, LOAD_FAILED.whiteboard),
    fileTree: bundleAtom(reach.fileTree, LOAD_FAILED.fileTree),
    terminal: bundleAtom(reach.terminal, LOAD_FAILED.terminal),
    diagram: bundleAtom(reach.diagram, LOAD_FAILED.diagram),
    diffView: bundleAtom(reach.diffView, LOAD_FAILED.diffView),
    factoryScene: bundleAtom(reach.factoryScene, LOAD_FAILED.factoryScene),
  };
}

/** The window's bundles, each through its own entry: what every surface reads unless a context hands others. */
export const SIDE_BUNDLES = sideBundles();

/**
 * A call's avatar, reached by the panel's call outside any surface
 * (`call/call-avatar.ts`), whose doors are what a test hands its own; so it
 * is read here rather than through the context.
 */
export const avatarSessionAtom = bundleAtom(
  () => shellBundles().avatarSession(),
  "The video could not be started.",
);

/** Each Factory world's bundle as imported, by its registry entry's importer. */
const worldBundles = new Map<
  WorldEntry["load"],
  Atom.Atom<AsyncResult.AsyncResult<WorldModule, Error>>
>();

/**
 * A Factory world's own bundle, imported the first time it is chosen and
 * kept, by its registry entry's importer, which is what keys it: a test
 * that offers a world of its own hands an entry of its own.
 */
export function worldBundleAtom(
  load: WorldEntry["load"],
): Atom.Atom<AsyncResult.AsyncResult<WorldModule, Error>> {
  const held = worldBundles.get(load);
  if (held !== undefined) return held;
  const bundle = bundleAtom(() => load().then((entry) => entry.world), WORLD_LOAD_FAILED);
  worldBundles.set(load, bundle);
  return bundle;
}

/** The bundles the surfaces under it read. */
export const SideBundlesContext = createContext<SideBundles>(SIDE_BUNDLES);

/** The bundles this surface reads. */
export function useSideBundles(): SideBundles {
  return useContext(SideBundlesContext);
}

/**
 * Starts the editor bundle loading, where it has not started already: the
 * panel calls it as it first paints, and a plan's text as the pointer comes
 * over it, so the editor is there by the time it is opened.
 */
export function usePrefetchEditorBundle(): () => void {
  const registry = useContext(RegistryContext);
  const { planEditor } = useSideBundles();
  return useCallback(() => {
    registry.get(planEditor);
  }, [registry, planEditor]);
}
