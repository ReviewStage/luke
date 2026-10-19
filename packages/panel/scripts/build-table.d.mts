// build-table.d.mts -- the panel's build table, typed for the web's Vite adapter (`apps/web/scripts/panel-build.ts`): the table stays plain JavaScript for the desktop's esbuild script (build-table.mjs).

import type { BuildOptions } from "esbuild";

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
export const HIGHLIGHT_WORKER_BUILD: BuildOptions & { readonly write: false };
export function panelDefines(highlightWorkerText: string): Readonly<Record<string, string>>;
export const EXCALIDRAW_STYLESHEET: string;
export function panelStaticDirectories(): readonly PanelStaticDirectory[];
