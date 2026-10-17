import { bundleAtom } from "../bundle-loader";
import { DIFF_VIEW_ASSET } from "../diff-view/contract";

/**
 * diff-view-bundle.ts -- the diff bundle, loaded once per window by the first Files changed view that shows a diff, and kept for the window's life.
 */

/** What the view says where the bundle failed to load. */
export const DIFF_LOAD_FAILED = "The diff could not be shown.";

export const diffViewModuleAtom = bundleAtom(
  { script: DIFF_VIEW_ASSET.SCRIPT, module: true },
  () => window.lukeDiffView,
  DIFF_LOAD_FAILED,
);
