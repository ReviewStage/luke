import { useAtomValue } from "@effect/atom-react";
import { PLAN_TREE_ENTRY } from "@sidecar/hosted/plan-wire";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MENU_DROP } from "../desktop/action-menu";
import type { FolderEntry } from "../file-tree/contract";
import { fileTreeModuleAtom } from "./file-tree-pane";
import type { ListFolder } from "./folder-listings";

/**
 * file-breadcrumbs.tsx -- a File tab's path as breadcrumbs: the repository, then each folder the file stands in, then the file, each a press that lists where it stands.
 *
 * Each crumb is the one control: a press lists the folder it stands in, its
 * siblings among them and itself marked, as VS Code's breadcrumbs and
 * Xcode's jump bar do, and the repository lists the root. The list is drawn
 * by the file tree bundle in rows the tree's own (`../file-tree/`), icons,
 * hover, type, and keys alike, so a crumb's list reads as a slice of the
 * tree beside it. A file chosen there opens in the tab; a folder is
 * revealed in the tree, opening the tree where it is closed. The chevrons
 * between are the path's punctuation and nothing more. The folder is listed
 * through what the tree has already listed (`folder-listings.ts`), so a list
 * of a folder the tree has open asks nothing. Every name here is the
 * repository's, so the list is left out of the screen recording
 * (`ph-no-capture`), as the tree is.
 */

/** A row of the tree as the compact density draws it, which the list's height is counted in. */
const ROW_HEIGHT = 24;
/** The tallest a crumb's list stands before it scrolls, and the room it keeps from the window's edges. */
const LIST_BOUNDS = { MAX_HEIGHT: 320, WIDTH: 260, MARGIN: 8, INSET: 4 } as const;

/** A folder listed in a crumb's list: the crumb, by its place in the path; its entries, or nothing where it could not be; and the crumb's own entry among them. */
interface Listed {
  readonly at: number;
  readonly folder: string;
  readonly entries: readonly FolderEntry[] | undefined;
  readonly current: string | undefined;
  readonly opener: HTMLElement;
}

/** A folder's path from the root, of a file's path cut after `count` segments. */
function folderOf(segments: readonly string[], count: number): string {
  return segments.slice(0, count).join("/");
}

/** An entry's path from the root, by the folder it stands in. */
function entryPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/**
 * A crumb's list, hung under the crumb over the window as a menu is. It
 * closes as a menu does: Escape, which hands the keyboard back to the
 * crumb, a press elsewhere, or the window losing the keyboard or changing
 * its size.
 */
function FolderList({
  label,
  listed,
  onChoose,
  onClose,
}: {
  label: string;
  listed: Listed;
  onChoose: (entry: FolderEntry, newTab: boolean) => void;
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  const loaded = useAtomValue(fileTreeModuleAtom);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; height: number } | undefined>(
    undefined,
  );
  const latest = useRef({ onChoose, onClose });
  latest.current = { onChoose, onClose };
  const { entries, current, opener } = listed;

  // The list hangs under the crumb, as tall as its rows up to its bound and
  // no taller than the room left under the crumb, its rows scrolling within.
  const rows = entries?.length ?? 1;
  useLayoutEffect(() => {
    const bounds = opener.getBoundingClientRect();
    const widest = window.innerWidth - LIST_BOUNDS.WIDTH - LIST_BOUNDS.MARGIN;
    const top = bounds.bottom + MENU_DROP;
    const wanted = Math.min(rows * ROW_HEIGHT + 2 * LIST_BOUNDS.INSET, LIST_BOUNDS.MAX_HEIGHT);
    const room = window.innerHeight - top - LIST_BOUNDS.MARGIN;
    setAt({
      left: Math.max(LIST_BOUNDS.MARGIN, Math.min(bounds.left, widest)),
      top,
      height: Math.max(ROW_HEIGHT + 2 * LIST_BOUNDS.INSET, Math.min(wanted, room)),
    });
  }, [opener, rows]);

  // Note that the list takes the keyboard itself where no row of it can,
  // as over an empty folder or one not listed, so Escape still reaches it.
  useEffect(() => {
    const element = box.current;
    if (at === undefined || element === null || element.contains(document.activeElement)) return;
    element.focus({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null || entries === undefined) return undefined;
    return module.list(element, {
      entries,
      current,
      onChoose: (entry, newTab) => latest.current.onChoose(entry, newTab),
    });
  }, [module, entries, current]);

  // Note that a press on the crumb is left to the crumb, whose own press
  // is what closes the list it opened.
  useEffect(() => {
    const pressed = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (box.current?.contains(target) || opener.contains(target)) return;
      latest.current.onClose(false);
    };
    const leave = () => latest.current.onClose(false);
    document.addEventListener("pointerdown", pressed, true);
    window.addEventListener("blur", leave);
    window.addEventListener("resize", leave);
    return () => {
      document.removeEventListener("pointerdown", pressed, true);
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", leave);
    };
  }, [opener]);

  return createPortal(
    <div
      ref={box}
      className="file-crumb-list ph-no-capture"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-placed={String(at !== undefined)}
      style={{ ...at, width: LIST_BOUNDS.WIDTH }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Note that the Escape is stopped here, because the window's own would close the panel behind the list.
        event.stopPropagation();
        latest.current.onClose(true);
      }}
    >
      {entries === undefined || AsyncResult.isFailure(loaded) ? (
        <p className="file-crumb-notice">
          {entries === undefined ? "Could not list this folder." : "The files could not be shown."}
        </p>
      ) : (
        <div className="file-crumb-tree" ref={host} />
      )}
    </div>,
    document.body,
  );
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
  /** Reveals a folder chosen in a crumb's list in the tree, opening the tree where it is closed. */
  onReveal: (folder: string) => void;
  /** Opens a file chosen in a crumb's list in the tab, or in a tab of its own where `newTab` asks. */
  onOpen: (path: string, newTab: boolean) => void;
}): React.JSX.Element {
  const segments = path.split("/");
  const [listed, setListed] = useState<Listed | undefined>(undefined);
  const asked = useRef(0);
  // The crumb whose folder is being listed, so a second press on it lets the list go before it opens.
  const pending = useRef<HTMLElement | undefined>(undefined);

  const close = (returnFocus: boolean) => {
    asked.current += 1;
    pending.current = undefined;
    if (returnFocus) listed?.opener.focus();
    setListed(undefined);
  };

  // The folder's entries, listed as a crumb opens its list; a press on the
  // crumb whose list stands closes it, and a later press stands in for one
  // still listing.
  const showEntries = (
    at: number,
    folder: string,
    current: string | undefined,
    opener: HTMLElement,
  ) => {
    if (listed?.opener === opener || pending.current === opener) return close(false);
    asked.current += 1;
    pending.current = opener;
    const ticket = asked.current;
    listFolder(folder).then((answer) => {
      if (ticket !== asked.current) return;
      pending.current = undefined;
      const entries =
        "folder" in answer
          ? answer.folder.entries.map((entry) => ({
              name: entry.name,
              folder: entry.kind === PLAN_TREE_ENTRY.FOLDER,
            }))
          : undefined;
      setListed({ at, folder, entries, current, opener });
    });
  };

  const choose = (entry: FolderEntry, newTab: boolean) => {
    if (listed === undefined) return;
    const chosen = entryPath(listed.folder, entry.name);
    close(false);
    if (entry.folder) onReveal(chosen);
    else onOpen(chosen, newTab);
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
                  aria-haspopup="dialog"
                  aria-expanded={listed?.at === at}
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
      {listed === undefined ? null : (
        <FolderList
          label={listed.folder === "" ? repository : listed.folder}
          listed={listed}
          onChoose={choose}
          onClose={close}
        />
      )}
    </nav>
  );
}
