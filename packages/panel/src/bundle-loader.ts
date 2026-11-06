import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { DiagramModule } from "@repo/ui/diagram-contract";
import { Effect } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";
import { createContext, useCallback, useContext } from "react";
import type { DiffViewModule } from "./diff-view/contract.js";
import type { FileTreeModule } from "./file-tree/contract.js";
import type { DescriptionEditorModule } from "./description-editor/contract.js";
import { rendererRuntime } from "./renderer-runtime.js";
import type { TerminalModule } from "./terminal/contract.js";

export type BundleImporter<A> = () => Promise<A>;

export interface SideBundleImporters {
  readonly descriptionEditor: BundleImporter<DescriptionEditorModule>;
  readonly fileTree: BundleImporter<FileTreeModule>;
  readonly terminal: BundleImporter<TerminalModule>;
  readonly diagram: BundleImporter<DiagramModule>;
  readonly diffView: BundleImporter<DiffViewModule>;
}

export type SideBundles = {
  readonly [Bundle in keyof SideBundleImporters]: Atom.Atom<
    AsyncResult.AsyncResult<Awaited<ReturnType<SideBundleImporters[Bundle]>>, Error>
  >;
};

export const TREE_LOAD_FAILED = "The files could not be shown.";

export const TERMINAL_LOAD_FAILED = "The terminal could not be shown.";

export const DIFF_LOAD_FAILED = "The diff could not be shown.";

export const DIAGRAM_REFUSED_LINE = "This diagram could not be drawn.";

const LOAD_FAILED = {
  descriptionEditor: "The editor could not be loaded.",
  fileTree: TREE_LOAD_FAILED,
  terminal: TERMINAL_LOAD_FAILED,
  diagram: DIAGRAM_REFUSED_LINE,
  diffView: DIFF_LOAD_FAILED,
} as const satisfies { readonly [Bundle in keyof SideBundleImporters]: string };

const SIDE_BUNDLE_IMPORTERS: SideBundleImporters = {
  descriptionEditor: () =>
    import("./description-editor/index.js").then((entry) => entry.descriptionEditor),
  fileTree: () => import("./file-tree/index.js").then((entry) => entry.fileTree),
  terminal: () => import("./terminal/index.js").then((entry) => entry.terminal),
  diagram: () => import("./diagram/index.js").then((entry) => entry.diagram),
  diffView: () => import("./diff-view/index.js").then((entry) => entry.diffView),
};

function bundleAtom<A>(
  importer: BundleImporter<A>,
  failure: string,
): Atom.Atom<AsyncResult.AsyncResult<A, Error>> {
  let landed: { readonly module: A } | undefined;
  const imported = Effect.tryPromise({
    try: importer,
    catch: (cause) => new Error(failure, { cause }),
  }).pipe(
    Effect.tap((module) =>
      Effect.sync(() => {
        landed = { module };
      }),
    ),
  );
  return rendererRuntime.atom(
    Effect.suspend(() => (landed === undefined ? imported : Effect.succeed(landed.module))),
  );
}

export function sideBundles(importers: Partial<SideBundleImporters> = {}): SideBundles {
  const reach: SideBundleImporters = { ...SIDE_BUNDLE_IMPORTERS, ...importers };
  return {
    descriptionEditor: bundleAtom(reach.descriptionEditor, LOAD_FAILED.descriptionEditor),
    fileTree: bundleAtom(reach.fileTree, LOAD_FAILED.fileTree),
    terminal: bundleAtom(reach.terminal, LOAD_FAILED.terminal),
    diagram: bundleAtom(reach.diagram, LOAD_FAILED.diagram),
    diffView: bundleAtom(reach.diffView, LOAD_FAILED.diffView),
  };
}

export const SIDE_BUNDLES = sideBundles();

export const SideBundlesContext = createContext<SideBundles>(SIDE_BUNDLES);

export function useSideBundles(): SideBundles {
  return useContext(SideBundlesContext);
}

export function usePrefetchEditorBundle(): () => void {
  const registry = useContext(RegistryContext);
  const { descriptionEditor } = useSideBundles();
  return useCallback(() => {
    registry.get(descriptionEditor);
  }, [registry, descriptionEditor]);
}
