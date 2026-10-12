import type { FileTree, FileTreeDirectoryHandle } from "@pierre/trees";
import type { FolderEntry, RevealOptions } from "./contract";

/**
 * folder-browser.ts -- the repository listed into Pierre's tree a folder at a time: a folder's entries read the first time it opens, and a path revealed by listing and opening each folder above it.
 *
 * Pierre's tree holds paths, not a loader, so the listing is driven from
 * outside it: each folder enters the tree empty, and the tree's own change
 * notice, which an open raises, is when a folder open but not yet listed
 * is read. A folder is read once; one that could not be read closes again,
 * so opening it once more reads it again. Pierre names a folder by its path
 * with a trailing slash, which is added and taken off at this file's edges,
 * so the repository's own paths are all the rest of the panel sees.
 */

/** The path Pierre's tree names an entry by: a folder's ends in a slash. */
function treePath(path: string, folder: boolean): string {
  return folder ? `${path}/` : path;
}

/** The repository's path of an entry the tree names. */
export function repositoryPath(treeId: string): string {
  return treeId.endsWith("/") ? treeId.slice(0, -1) : treeId;
}

/** An entry's path from the root, by the folder it stands in. */
function joined(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/** The folder's entry in the tree, where it stands there. */
function folderItem(tree: FileTree, folder: string): FileTreeDirectoryHandle | undefined {
  const item = tree.getItem(treePath(folder, true));
  return item !== null && "expand" in item ? item : undefined;
}

/** The folders a path stands in, the root first and the nearest last. */
function foldersAbove(path: string): readonly string[] {
  const segments = path.split("/");
  return ["", ...segments.slice(0, -1).map((_, at) => segments.slice(0, at + 1).join("/"))];
}

/** The tree listed as it opens: reveal a path in it, and stop listing. */
export interface FolderBrowser {
  /** Lists and opens each folder above the path, then scrolls to it; answers once it has. */
  readonly reveal: (path: string, options: RevealOptions) => Promise<void>;
  readonly dispose: () => void;
}

/** Lists one folder's entries, or nothing where it could not be listed. */
export type ListEntries = (path: string) => Promise<readonly FolderEntry[] | undefined>;

/** Lists the repository into the tree given, the root first, each folder as it opens. */
export function browseFolders(tree: FileTree, readFolder: ListEntries): FolderBrowser {
  // Each folder's listing, read or in flight, and the folders in the tree not yet read.
  const listings = new Map<string, Promise<boolean>>();
  const unlisted = new Set<string>();
  let revealing = 0;

  const opened = (folder: string): boolean => folderItem(tree, folder)?.isExpanded() === true;

  // Note that a folder that could not be read is closed, because the tree
  // reads an open one on every change it notices and would ask again at once.
  const missed = (folder: string): boolean => {
    listings.delete(folder);
    if (folder === "") return false;
    unlisted.add(folder);
    folderItem(tree, folder)?.collapse();
    return false;
  };

  const list = (folder: string): Promise<boolean> => {
    const standing = listings.get(folder);
    if (standing !== undefined) return standing;
    unlisted.delete(folder);
    const listing = readFolder(folder).then(
      (entries) => {
        if (entries === undefined) return missed(folder);
        const added = entries.map((entry) => ({
          path: joined(folder, entry.name),
          folder: entry.folder,
        }));
        for (const entry of added) if (entry.folder) unlisted.add(entry.path);
        tree.batch(
          added.map((entry) => ({ type: "add", path: treePath(entry.path, entry.folder) })),
        );
        return true;
      },
      () => missed(folder),
    );
    listings.set(folder, listing);
    return listing;
  };

  const unsubscribe = tree.subscribe(() => {
    for (const folder of [...unlisted]) if (opened(folder)) list(folder);
  });
  list("");

  const reveal = async (path: string, options: RevealOptions): Promise<void> => {
    revealing += 1;
    const ticket = revealing;
    const folders = options.folder ? [...foldersAbove(path), path] : foldersAbove(path);
    for (const folder of folders) {
      const listed = await list(folder);
      // A later reveal stands in for this one, and a folder unread ends it.
      if (ticket !== revealing || !listed) return;
      const item = folder === "" ? undefined : folderItem(tree, folder);
      if (item !== undefined && !item.isExpanded()) item.expand();
    }
    const id = treePath(path, options.folder);
    const item = tree.getItem(id);
    if (item === null) return;
    if (!options.folder) {
      for (const selected of tree.getSelectedPaths()) {
        if (selected !== id) tree.getItem(selected)?.deselect();
      }
      if (!item.isSelected()) item.select();
    }
    tree.scrollToPath(id, { focus: options.focus, offset: "center" });
  };

  return { reveal, dispose: unsubscribe };
}
