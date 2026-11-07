import type { DiagramModule } from "@repo/ui/diagram-contract";
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext } from "react";
import type { DescriptionEditorModule } from "./description-editor/contract.js";
import type { DiffViewModule } from "./diff-view/contract.js";
import type { FileTreeModule } from "./file-tree/contract.js";
import type { TerminalModule } from "./terminal/contract.js";

/**
 * bundle-loader.ts -- the bundles of the panel's own that are too large for the one every window parses, each imported the first time it is needed and kept for the window's life.
 *
 * The panel's editors (`description-editor/`), a File tab's tree (`file-tree/`), a
 * Terminal tab's screen (`terminal/`), a description's diagrams (`diagram/`), and a
 * Files changed diff (`diff-view/`) are each
 * reached through a dynamic `import()` of their entry, which the bundler splits off the bundle every window parses
 * and loads from wherever it put it, so nothing here names a file. Where a
 * bundle has a stylesheet, its entry imports it. A bundle that landed is
 * kept, so leaving the surface and coming back loads nothing; one that
 * failed is imported again by the next surface to read it, as a connection
 * that dropped for a moment has come back.
 *
 * Each bundle is read through TanStack Query, built with `queryOptions`
 * (`bundleQuery`), since an import is async data: pending, then the module or
 * why it could not be had. A surface reads one with `useQuery`, so its first
 * read imports it, every reader after has it from the window's client, and
 * Retry is the query's `refetch`. It reads the bundles built over
 * `SIDE_BUNDLE_IMPORTERS` unless a `SideBundlesContext` above it hands
 * others, as a test does to stand a bundle in or to have one fail; each test
 * draws on a Query client of its own, so a key names the bundle alone.
 */

/** How a bundle is reached: its entry imported, answering the module it exports. */
export type BundleImporter<A> = () => Promise<A>;

/** How each bundle of the panel's own is reached. */
export interface SideBundleImporters {
  readonly descriptionEditor: BundleImporter<DescriptionEditorModule>;
  readonly fileTree: BundleImporter<FileTreeModule>;
  readonly terminal: BundleImporter<TerminalModule>;
  readonly diagram: BundleImporter<DiagramModule>;
  readonly diffView: BundleImporter<DiffViewModule>;
}

/** Each bundle of the panel's own. */
export type SideBundles = {
  readonly [Bundle in keyof SideBundleImporters]: SideBundle<
    Awaited<ReturnType<SideBundleImporters[Bundle]>>
  >;
};

/** What a File tab's tree and breadcrumbs say where their bundle failed to load; a type icon keeps its placeholder. */
export const TREE_LOAD_FAILED = "The files could not be shown.";

/** What a Terminal tab says where its bundle failed to load. */
export const TERMINAL_LOAD_FAILED = "The terminal could not be shown.";

/** What the Files changed view says where its bundle failed to load. */
export const DIFF_LOAD_FAILED = "The diff could not be shown.";

/** What a fence says over its code where the diagram bundle failed to load, as it says where Mermaid refused the code. */
export const DIAGRAM_REFUSED_LINE = "This diagram could not be drawn.";

/** Why each bundle could not be had, where its import failed. */
const LOAD_FAILED = {
  descriptionEditor: "The editor could not be loaded.",
  fileTree: TREE_LOAD_FAILED,
  terminal: TERMINAL_LOAD_FAILED,
  diagram: DIAGRAM_REFUSED_LINE,
  diffView: DIFF_LOAD_FAILED,
} as const satisfies { readonly [Bundle in keyof SideBundleImporters]: string };

/** Each bundle's entry, imported where the bundler put it. */
const SIDE_BUNDLE_IMPORTERS: SideBundleImporters = {
  descriptionEditor: () =>
    import("./description-editor/index.js").then((entry) => entry.descriptionEditor),
  fileTree: () => import("./file-tree/index.js").then((entry) => entry.fileTree),
  terminal: () => import("./terminal/index.js").then((entry) => entry.terminal),
  diagram: () => import("./diagram/index.js").then((entry) => entry.diagram),
  diffView: () => import("./diff-view/index.js").then((entry) => entry.diffView),
};

/**
 * A bundle's read: its entry imported the first time it is read, as the
 * module it exports, or the failure given. A module that landed is kept for
 * the window's life and never read again, as a script that has run is.
 * A failure is kept too, since `gcTime` holds for the query whatever it
 * answered, but a query holding an error and no module is read again by the
 * next surface to mount over it (Query's `retryOnMount`), as a connection
 * that dropped for a moment has come back; it is not retried on its own.
 */
function bundleQuery<A>(name: keyof SideBundleImporters, importer: BundleImporter<A>) {
  return queryOptions({
    queryKey: ["side-bundle", name] as const,
    queryFn: () =>
      importer().catch(
        // Note that the import's own error is kept as the cause, so a report names the chunk that failed.
        (cause: unknown) => Promise.reject(new Error(LOAD_FAILED[name], { cause })),
      ),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** A bundle's read, as `useQuery` and the client take it, answering the module its entry exports. */
export type SideBundle<A> = ReturnType<typeof bundleQuery<A>>;

/** The bundles, each imported through the importer given and the rest through their own entries. */
export function sideBundles(importers: Partial<SideBundleImporters> = {}): SideBundles {
  const reach: SideBundleImporters = { ...SIDE_BUNDLE_IMPORTERS, ...importers };
  return {
    descriptionEditor: bundleQuery("descriptionEditor", reach.descriptionEditor),
    fileTree: bundleQuery("fileTree", reach.fileTree),
    terminal: bundleQuery("terminal", reach.terminal),
    diagram: bundleQuery("diagram", reach.diagram),
    diffView: bundleQuery("diffView", reach.diffView),
  };
}

/** The window's bundles, each through its own entry: what every surface reads unless a context hands others. */
export const SIDE_BUNDLES = sideBundles();

/** The bundles the surfaces under it read. */
export const SideBundlesContext = createContext<SideBundles>(SIDE_BUNDLES);

/** The bundles this surface reads. */
export function useSideBundles(): SideBundles {
  return useContext(SideBundlesContext);
}

/**
 * Starts the editor bundle loading, where it has not started already: the
 * panel calls it as it first paints, and a description's text as the pointer comes
 * over it, so the editor is there by the time it is opened.
 */
export function usePrefetchEditorBundle(): () => void {
  const client = useQueryClient();
  const { descriptionEditor } = useSideBundles();
  return useCallback(() => {
    void client.prefetchQuery(descriptionEditor);
  }, [client, descriptionEditor]);
}
