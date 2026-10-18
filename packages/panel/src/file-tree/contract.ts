/**
 * contract.ts -- what a File tab and the file tree bundle say to each other: the one mount call, and the handle a tab moves the tree through.
 *
 * The tree beside a File tab is drawn by Pierre's tree (`@pierre/trees`),
 * which is too large for the bundle every window parses, so it ships as a
 * bundle of its own (`file-tree.js`, built from `./index.ts`) that the tab
 * loads the first time its tree is shown, as the Tasks tab loads the
 * whiteboard. That bundle exports one module, `fileTree`, and this
 * file is the whole of what the two share: no Pierre type crosses, only the
 * repository's own paths and names, and nothing here imports anything, so
 * the bundle carries none of the panel's libraries, its wire schemas
 * included.
 *
 * A path is the repository's, from its root, without a leading or trailing
 * slash; the root itself is the empty path. A breadcrumb mounts the same
 * tree under its crumb (`../tasks/file-breadcrumbs.tsx`), over the folder
 * the crumb stands in, so its paths are that folder's, from it.
 *
 * The same bundle answers what icon a file's type draws as, so a file
 * attached to a message (`../tasks/attached-file-chips.tsx`) or listed in
 * the task's summary (`../desktop/task-summary.tsx`) is drawn as the tree
 * draws it, without Pierre's icons riding in the bundle every window parses.
 */

/** One entry of a folder: its name within the folder, and whether it is a folder itself. */
export interface FolderEntry {
  readonly name: string;
  readonly folder: boolean;
}

/**
 * A folder listed: its entries, and whether the service cut them short of
 * the whole folder; or, in the tab's own words, why it was not listed, and
 * whether listing it again may help.
 */
export type FolderListing =
  | { readonly entries: readonly FolderEntry[]; readonly truncated: boolean }
  | { readonly notice: string; readonly retry: boolean };

/** Lists one folder of the repository. */
export type ReadFolder = (path: string) => Promise<FolderListing>;

/** What became of a file in a change set, as its row in the tree is marked: A, M, D, or R. */
export const FILE_MARK = {
  ADDED: "added",
  MODIFIED: "modified",
  DELETED: "deleted",
  RENAMED: "renamed",
} as const;

export type FileMarkStatus = (typeof FILE_MARK)[keyof typeof FILE_MARK];

/** One file's mark: its path and what became of it. */
export interface FileMark {
  readonly path: string;
  readonly status: FileMarkStatus;
}

/** What the tab hands the tree when it mounts it. */
export interface FileTreeProps {
  /**
   * Lists a folder the first time it opens, the root before the tree is
   * drawn, whose notice stands in the tree's place; the tab answers from
   * what it already read where it can.
   */
  readonly readFolder: ReadFolder;
  /** A file chosen in the tree, by a press or Return: open it, in a tab of its own where ⌘ was held. */
  readonly onOpen: (path: string, newTab: boolean) => void;
  /**
   * How many rows the repository's tree shows, each time a folder listed,
   * opened, or closed changes it, which a breadcrumb's tree sizes its box
   * by. Note that a search or the filter is not counted, because only the
   * pane narrows its tree and the pane sizes nothing by its rows.
   */
  readonly onRows?: (rows: number) => void;
}

/** Whether `reveal` takes the keyboard to the file it brings into view. */
export interface RevealOptions {
  /** Whether the tree takes the keyboard on the file, as a breadcrumb's tree does as it opens. */
  readonly focus: boolean;
}

/** The tree as mounted: bring a path into view, narrow the rows shown, and take the tree down. */
export interface FileTreeHandle {
  /**
   * Lists and opens each folder above a file, then marks it as the one
   * shown and scrolls it into view. A later reveal stands in for one still
   * listing, and one asked before the root is listed waits for it.
   */
  readonly reveal: (path: string, options: RevealOptions) => void;
  /**
   * Shows only the rows whose path holds the query, the folders above them
   * opened, or says no file matches; the empty query shows every row again.
   */
  readonly search: (query: string) => void;
  /** Shows only these files, every folder above them opened, or the whole repository for none. */
  readonly only: (paths: readonly string[] | undefined) => void;
  /**
   * Hands the tree every entry of the repository, each named by its path
   * from the root, which a search then narrows in place of the folders
   * listed so far.
   */
  readonly within: (entries: readonly FolderEntry[]) => void;
  /**
   * Marks each file's row with what became of it, as an editor's source
   * control does, and each folder above one as holding a change; none
   * marks nothing.
   */
  readonly mark: (marks: readonly FileMark[]) => void;
  readonly unmount: () => void;
}

/**
 * A file's type icon as the tree draws it: the symbol to draw, from the
 * sheet the bundle adds to the document the first time one is asked for,
 * and the type it stands for, which the panel colours it by
 * (`styles/tasks.css`).
 */
export interface FileTypeIcon {
  readonly symbol: string;
  readonly type: string;
}

/** What the file tree bundle's entry exports, which the panel imports the first time it is needed (`../bundle-loader.ts`). */
export interface FileTreeModule {
  readonly mount: (host: HTMLElement, props: FileTreeProps) => FileTreeHandle;
  /** The type icon of a file by its name alone. */
  readonly fileIcon: (name: string) => FileTypeIcon;
}
