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
 * file-breadcrumbs.tsx -- a File tab's path as breadcrumbs: the repository, then each folder the file stands in, then the file, each a press that lists where it stands.
 *
 * Each crumb is the one control: a press lists the folder it stands in, its
 * siblings among them and itself checked, as VS Code's breadcrumbs and
 * Xcode's jump bar do, and the repository lists the root. A file chosen
 * there opens in the tab; a folder is revealed in the tree beside it,
 * opening the tree where it is closed. The chevrons between are the path's
 * punctuation and nothing more. The folder is listed through what the tree
 * has already listed (`folder-listings.ts`), so a menu of a folder the tree
 * has open asks nothing.
 */

/** A folder listed in a crumb's menu: the crumb, by its place in the path; its entries, or nothing where it could not be; and the crumb's own entry among them. */
type Listed = {
  readonly at: number;
  readonly folder: string;
  readonly entries: readonly PlanTreeEntry[] | undefined;
  readonly current: string | undefined;
};

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
    ...(entry.name === listed.current ? { checked: true } : undefined),
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
  /** Reveals a folder chosen in a crumb's menu in the tree, opening the tree where it is closed. */
  onReveal: (folder: string) => void;
  /** Opens a file chosen in a crumb's menu in the tab. */
  onOpen: (path: string) => void;
}): React.JSX.Element {
  const segments = path.split("/");
  const menu = useActionMenu(true);
  const [listed, setListed] = useState<Listed | undefined>(undefined);

  // The folder's entries, listed as a crumb opens their menu; a press on
  // the crumb whose menu stands closes it.
  const showEntries = (
    at: number,
    folder: string,
    current: string | undefined,
    button: HTMLElement,
  ) => {
    if (menu.open?.opener === button) {
      menu.close(true);
      return;
    }
    const placement = {
      ...dropBelow(button),
      x: button.getBoundingClientRect().left,
      align: MENU_ALIGN.START,
    };
    listFolder(folder).then((answer) => {
      const entries = "folder" in answer ? answer.folder.entries : undefined;
      setListed({ at, folder, entries, current });
      menu.show(placement, button);
    });
  };

  const crumbs = [repository, ...segments];
  return (
    <nav className="file-breadcrumbs" aria-label="Path">
      <ol>
        {crumbs.map((name, at) => {
          const last = at === crumbs.length - 1;
          // The repository lists the root; any other crumb the folder it stands in.
          const folder = folderOf(segments, Math.max(0, at - 1));
          return (
            // Note that a crumb is keyed by the path it ends, since a name may stand twice in one.
            <Fragment key={folderOf(segments, at)}>
              {at === 0 ? null : (
                <li className="file-breadcrumb-separator" aria-hidden="true">
                  <ChevronRightIcon />
                </li>
              )}
              <li>
                <button
                  type="button"
                  className="file-breadcrumb"
                  aria-current={last ? "page" : undefined}
                  aria-haspopup="menu"
                  aria-expanded={menu.open !== undefined && listed?.at === at}
                  onClick={(event) =>
                    showEntries(at, folder, at === 0 ? undefined : name, event.currentTarget)
                  }
                >
                  {name}
                </button>
              </li>
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
