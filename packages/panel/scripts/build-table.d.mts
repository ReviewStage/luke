// build-table.d.mts -- the panel's build table, typed for the web's Vite adapter (`apps/web/scripts/panel-build.ts`): the table stays plain JavaScript for the desktop's esbuild script (build-table.mjs).

/** A folder of static files: the directory it is copied from, and the path under the asset base it is served at. */
export interface PanelStaticDirectory {
  readonly from: string;
  readonly to: string;
}

export const REDIRECTED: RegExp;
export function redirectOf(specifier: string, importer: string | undefined): string | undefined;
export const EXCALIDRAW_UNUSED: RegExp;
export const EXCALIDRAW_UNUSED_MODULE: string;
export function excalidrawLeftOut(specifier: string, importer: string | undefined): boolean;
export const LUCIDE_WHOLE: string;
export function lucideWholeModule(file: string): string;
/**
 * The highlight worker's esbuild options, spelled out here so the panel takes
 * no dependency on esbuild for their type: its one plugin is typed by the
 * part of esbuild's build object it calls.
 */
interface WorkerPluginBuild {
  onResolve(
    options: { filter: RegExp },
    callback: (args: { path: string }) => { path: string; namespace: string },
  ): void;
  onLoad(
    options: { filter: RegExp; namespace: string },
    callback: () => { contents: string; loader: "js" },
  ): void;
}

export interface HighlightWorkerBuild {
  readonly entryPoints: string[];
  readonly bundle: true;
  readonly write: false;
  readonly platform: "browser";
  readonly format: "iife";
  readonly target: string;
  readonly minify: true;
  readonly conditions: string[];
  readonly plugins: { readonly name: string; setup: (build: WorkerPluginBuild) => void }[];
  readonly define: { readonly [identifier: string]: string };
  readonly logLevel: "info";
}

export const HIGHLIGHT_WORKER_BUILD: HighlightWorkerBuild;
export function panelDefines(highlightWorkerText: string): {
  readonly [identifier: string]: string;
};
export const EXCALIDRAW_STYLESHEET: string;
export function panelStaticDirectories(): readonly PanelStaticDirectory[];
