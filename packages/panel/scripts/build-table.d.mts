export interface PanelStaticDirectory {
  readonly from: string;
  readonly to: string;
}

export const REDIRECTED: RegExp;
export function redirectOf(specifier: string, importer: string | undefined): string | undefined;
export const LUCIDE_WHOLE: string;
export function lucideWholeModule(file: string): string;
interface WorkerPluginBuild {
  onResolve(
    options: { filter: RegExp },
    callback: (args: { path: string }) => { path: string; namespace: string },
  ): void;
  onLoad(
    options: { filter: RegExp; namespace: string },
    callback: (args: { path: string }) => { contents: string; loader: "js" },
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
export function panelStaticDirectories(): readonly PanelStaticDirectory[];
