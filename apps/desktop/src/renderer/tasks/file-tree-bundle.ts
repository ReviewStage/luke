import { bundleAtom } from "../bundle-loader";
import { FILE_TREE_ASSET } from "../file-tree/contract";

/**
 * file-tree-bundle.ts -- the file tree bundle, loaded once per window by whichever needs it first: a File tab's tree, a breadcrumb's list, or a file's type icon, and kept for the window's life.
 */

/** What the tree says where the bundle failed to load; a type icon keeps its placeholder. */
export const TREE_LOAD_FAILED = "The files could not be shown.";

export const fileTreeModuleAtom = bundleAtom(
  { script: FILE_TREE_ASSET.SCRIPT },
  () => window.lukeFileTree,
  TREE_LOAD_FAILED,
);
