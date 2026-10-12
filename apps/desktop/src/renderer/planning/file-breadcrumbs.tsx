import { PLAN_TREE_ENTRY, type PlanTreeEntry } from "@sidecar/hosted/plan-wire";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useState } from "react";
import {
  ActionMenu,
  dropBelow,
  MENU_ALIGN,
  type MenuAction,
  useActionMenu,
} from "../desktop/action-menu";
import type { ListFolder } from "./folder-listings";

/**
 * file-breadcrumbs.tsx -- a File tab's path as breadcrumbs: the repository, then each folder the file stands in, then the file, every folder one press from the tree.
 *
 * A press on the repository or a folder reveals it in the tree beside the
 * tab, opening the tree where it is closed, as a devtool's breadcrumbs
 * browse. The chevron after each lists that folder's entries in a menu, the
 * one the path goes on to among them, as Xcode's jump bar and VS Code's
 * breadcrumbs do: a file chosen there opens in the tab, a folder is
 * revealed in the tree. The folder is listed through what the tree has
 * already listed (`folder-listings.ts`), so a menu of a folder the tree has
 * open asks nothing.
 */

/** Where a folder listed in a chevron's menu stands: being read, or read, its entries or nothing where it could not be. */
type Listed = { readonly folder: string; readonly entries: readonly PlanTreeEntry[] | undefined };

/** A folder's path from the root, of a file's path cut after `count` segments. */
function folderOf(segments: readonly string[], count: number): string {
  return segments.slice(0, count).join("/");
}

/** An entry's path from the root, by the folder it stands in. */
function entryPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/** The menu's actions for a folder's entries: its folders, then its files, each as the tree sorts them. */
function entryGroups(
  listed: Listed,
  onReveal: (path: string) => void,
  onOpen: (path: string) => void,
): readonly (readonly MenuAction[])[] {
  if (listed.entries === undefined) {
    return [[{ label: "Could not list this folder", onSelect: () => undefined, disabled: true }]];
  }
  const byName = [...listed.entries].sort((a, b) => a.name.localeCompare(b.name));
  const action = (entry: PlanTreeEntry, folder: boolean): MenuAction => ({
    label: folder ? `${entry.name}/` : entry.name,
    onSelect: () => {
      const path = entryPath(listed.folder, entry.name);
      if (folder) onReveal(path);
      else onOpen(path);
    },
  });
  const folders = byName.filter((entry) => entry.kind === PLAN_TREE_ENTRY.FOLDER);
  const files = byName.filter((entry) => entry.kind !== PLAN_TREE_ENTRY.FOLDER);
  return [
    folders.map((entry) => action(entry, true)),
    files.map((entry) => action(entry, false)),
  ].filter((group) => group.length > 0);
}

export function FileBreadcrumbs({
  repository,
  path,
  listFolder,
  onReveal,
  onOpen,
}: {
  /** The plan's repository, `owner/name`, the first crumb. */
  repository: string;
  /** The tab's file, from the repository's root. */
  path: string;
  listFolder: ListFolder;
  /** Reveals a folder in the tree, the root for the empty path, opening the tree where it is closed. */
  onReveal: (folder: string) => void;
  /** Opens a file chosen in a chevron's menu in the tab. */
  onOpen: (path: string) => void;
}): React.JSX.Element {
  const segments = path.split("/");
  const menu = useActionMenu(true);
  const [listed, setListed] = useState<Listed | undefined>(undefined);

  // The folder's entries, listed as its chevron opens their menu.
  const showEntries = (folder: string, button: HTMLElement) => {
    const placement = {
      ...dropBelow(button),
      x: button.getBoundingClientRect().left,
      align: MENU_ALIGN.START,
    };
    listFolder(folder).then((answer) => {
      setListed({ folder, entries: "folder" in answer ? answer.folder.entries : undefined });
      menu.show(placement, button);
    });
  };

  const crumbs = [repository, ...segments];
  return (
    <nav className="file-breadcrumbs" aria-label="Path">
      <ol>
        {crumbs.map((name, at) => {
          const last = at === crumbs.length - 1;
          const folder = folderOf(segments, at);
          return (
            // Note that a crumb is keyed by the path it ends, since a name may stand twice in one.
            <Fragment key={folder}>
              <li>
                {last ? (
                  <span className="file-breadcrumb" aria-current="page">
                    {name}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="file-breadcrumb"
                    onClick={() => onReveal(folder)}
                  >
                    {name}
                  </button>
                )}
              </li>
              {last ? null : (
                <li>
                  <button
                    type="button"
                    className="file-breadcrumb-chevron"
                    aria-label={`Entries of ${at === 0 ? repository : folder}`}
                    aria-haspopup="menu"
                    onClick={(event) => showEntries(folder, event.currentTarget)}
                  >
                    <ChevronRightIcon aria-hidden="true" />
                  </button>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
      {menu.open === undefined || listed === undefined ? null : (
        <ActionMenu
          label={listed.folder === "" ? repository : listed.folder}
          menu={menu.open}
          groups={entryGroups(listed, onReveal, onOpen)}
          onClose={menu.close}
        />
      )}
    </nav>
  );
}
