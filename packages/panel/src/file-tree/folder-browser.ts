import type { FileTree, FileTreeDirectoryHandle } from "@pierre/trees";
import type { FolderEntry, RevealOptions } from "./contract.js";

export function treePath(path: string, folder: boolean): string {
  return folder ? `${path}/` : path;
}

export function repositoryPath(treeId: string): string {
  return treeId.endsWith("/") ? treeId.slice(0, -1) : treeId;
}

function joined(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

function folderItem(tree: FileTree, folder: string): FileTreeDirectoryHandle | undefined {
  const item = tree.getItem(treePath(folder, true));
  return item !== null && "expand" in item ? item : undefined;
}

export function keepMarked(tree: FileTree, id: string | undefined): void {
  for (const selected of tree.getSelectedPaths()) {
    if (selected !== id) tree.getItem(selected)?.deselect();
  }
  const item = id === undefined ? null : tree.getItem(id);
  if (item !== null && !item.isSelected()) item.select();
}

export function markAlone(tree: FileTree, id: string, focus: boolean): void {
  keepMarked(tree, id);
  if (tree.getItem(id) === null) return;
  tree.scrollToPath(id, { focus, offset: "center" });
}

function foldersAbove(path: string): readonly string[] {
  const segments = path.split("/");
  return ["", ...segments.slice(0, -1).map((_, at) => segments.slice(0, at + 1).join("/"))];
}

export interface FolderBrowser {
  readonly reveal: (path: string, options: RevealOptions) => Promise<void>;
  readonly dispose: () => void;
}

export type ListEntries = (path: string) => Promise<readonly FolderEntry[] | undefined>;

export function browseFolders(tree: FileTree, readFolder: ListEntries): FolderBrowser {
  const listings = new Map<string, Promise<boolean>>();
  const unlisted = new Set<string>();
  let revealing = 0;

  const opened = (folder: string): boolean => folderItem(tree, folder)?.isExpanded() === true;

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
        const [lone, ...others] = added;
        if (folder !== "" && lone?.folder && others.length === 0) {
          folderItem(tree, lone.path)?.expand();
        }
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
    for (const folder of foldersAbove(path)) {
      const listed = await list(folder);
      if (ticket !== revealing || !listed) return;
      const item = folder === "" ? undefined : folderItem(tree, folder);
      if (item !== undefined && !item.isExpanded()) item.expand();
    }
    markAlone(tree, path, options.focus);
  };

  return { reveal, dispose: unsubscribe };
}
