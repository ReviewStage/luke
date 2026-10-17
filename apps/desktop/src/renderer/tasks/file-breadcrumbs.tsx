import { useAtomValue } from "@effect/atom-react";
import { MENU_DROP } from "@luke/ui";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TREE_LOAD_FAILED, useSideBundles } from "../bundle-loader";
import type { ReadFolder } from "../file-tree/contract";
import { Tooltip } from "../tooltip";

/**
 * file-breadcrumbs.tsx -- a File tab's path as breadcrumbs: the repository, then each folder the file stands in, then the file, each a press that opens the tree where it stands.
 *
 * Each crumb is the one control: a press hangs the file tree under it,
 * rooted at the folder the crumb stands in, the repository's root for the
 * repository, with the tab's file revealed in it, its folders opened, it
 * marked and taking the keyboard, as VS Code's breadcrumbs do. It is the
 * tree beside the tab, mounted again through the file tree bundle
 * (`../file-tree/`): its icons, hover, keys, and lone folders sharing a row
 * alike, a folder opening in place and listed as it opens. A file chosen
 * there opens in the tab and takes the tree down. The chevrons between are
 * the path's punctuation and nothing more. Each folder is listed through
 * what the tree beside the tab has already listed (`folder-listings.ts`),
 * so a folder it has open asks nothing. Every name here is the
 * repository's, so the tree is left out of the screen recording
 * (`ph-no-capture`), as the pane's is.
 *
 * The path gives way in the stylesheet alone, so the bar measures nothing:
 * every crumb narrows, cut short at its end, the repository and the folders
 * first, the file's own name last; on a bar narrower than 520px the folders
 * between the repository and the file's own folder stand as one "…" crumb,
 * and on one narrower than 300px the repository and every folder do, the
 * file alone after it; the "…" names what it stands for in its pill and
 * hangs the tree the last of them would (`planning.css`'s `@container
 * file-bar`). Both "…" are drawn, and the stylesheet shows the one the bar's
 * width asks for.
 */

/** What the "…" crumb is called, before the folders it stands for. */
const FOLDED_LABEL = "Folders";

/** Where a "…" crumb's tree is marked open, apart from every crumb's own place in the path. */
const FOLDED_MIDDLE = -1;
const FOLDED_ALL = -2;

/** A row of the tree as the compact density draws it, which the box's height is counted in. */
const ROW_HEIGHT = 24;
/** The tallest a crumb's tree stands before it scrolls, its width, and the room it keeps from the window's edges. */
const TREE_BOUNDS = { MAX_HEIGHT: 360, WIDTH: 280, MARGIN: 8, INSET: 4 } as const;

/** A crumb's tree standing open: the tab's file it was opened over; the crumb, by its place in the path; the folder the tree is rooted at; and the tab's file from that folder, which it reveals. */
interface Opened {
  readonly path: string;
  readonly at: number;
  readonly folder: string;
  readonly file: string;
  readonly opener: HTMLElement;
}

/** A folder's path from the root, of a file's path cut after `count` segments. */
function folderOf(segments: readonly string[], count: number): string {
  return segments.slice(0, count).join("/");
}

/** A path in a crumb's tree, from the folder it is rooted at, as the repository's from its root; the empty path is the folder itself. */
function fromRoot(folder: string, path: string): string {
  if (folder === "" || path === "") return folder === "" ? path : folder;
  return `${folder}/${path}`;
}

/**
 * A crumb's tree, hung under the crumb over the window as a menu is, as
 * tall as the rows it shows up to its bound and no taller than the room
 * left under the crumb, its rows scrolling within. It closes as a menu
 * does: Escape, which hands the keyboard back to the crumb, a press
 * elsewhere, or the window losing the keyboard or changing its size.
 */
function CrumbTree({
  label,
  opened,
  listFolder,
  onOpen,
  onClose,
}: {
  label: string;
  opened: Opened;
  listFolder: ReadFolder;
  onOpen: (path: string, newTab: boolean) => void;
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().fileTree);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<number | undefined>(undefined);
  const [at, setAt] = useState<{ left: number; top: number; height?: number } | undefined>(
    undefined,
  );
  const latest = useRef({ listFolder, onOpen, onClose });
  latest.current = { listFolder, onOpen, onClose };
  const { folder, file, opener } = opened;

  // Note that the box stands as tall as its words until the tree counts its rows.
  useLayoutEffect(() => {
    const bounds = opener.getBoundingClientRect();
    const widest = window.innerWidth - TREE_BOUNDS.WIDTH - TREE_BOUNDS.MARGIN;
    const top = bounds.bottom + MENU_DROP;
    const left = Math.max(TREE_BOUNDS.MARGIN, Math.min(bounds.left, widest));
    if (rows === undefined) return setAt({ left, top });
    const fewest = ROW_HEIGHT + 2 * TREE_BOUNDS.INSET;
    const room = window.innerHeight - top - TREE_BOUNDS.MARGIN;
    const wanted = Math.min(rows * ROW_HEIGHT + 2 * TREE_BOUNDS.INSET, TREE_BOUNDS.MAX_HEIGHT);
    setAt({ left, top, height: Math.max(fewest, Math.min(wanted, room)) });
  }, [opener, rows]);

  // Note that the box takes the keyboard itself until the tree's reveal
  // takes it to the file, and keeps it where the tree has no row to take
  // it, so Escape still reaches it.
  const placed = at !== undefined;
  useEffect(() => {
    const element = box.current;
    if (!placed || element === null || element.contains(document.activeElement)) return;
    element.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    const tree = module.mount(element, {
      readFolder: (path) => latest.current.listFolder(fromRoot(folder, path)),
      onOpen: (path, newTab) => {
        latest.current.onClose(false);
        latest.current.onOpen(fromRoot(folder, path), newTab);
      },
      onRows: setRows,
    });
    tree.reveal(file, { focus: true });
    return tree.unmount;
  }, [module, folder, file]);

  // Note that a press on the crumb is left to the crumb, whose own press
  // is what closes the tree it opened.
  useEffect(() => {
    const pressed = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (box.current?.contains(target) || opener.contains(target)) return;
      latest.current.onClose(false);
    };
    const leave = () => latest.current.onClose(false);
    // The bar resized, its panel dragged, may fold the crumb the tree hangs
    // from out of sight (planning.css), so the tree goes, as it does when the
    // window resizes. Note that it watches only while a tree stands, and
    // reads nothing of the layout.
    const bar = opener.closest(".file-view-bar");
    let first = true;
    const folded = new ResizeObserver(() => {
      if (first) first = false;
      else leave();
    });
    if (bar !== null) folded.observe(bar);
    document.addEventListener("pointerdown", pressed, true);
    window.addEventListener("blur", leave);
    window.addEventListener("resize", leave);
    return () => {
      folded.disconnect();
      document.removeEventListener("pointerdown", pressed, true);
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", leave);
    };
  }, [opener]);

  return createPortal(
    <div
      ref={box}
      className="menu-surface file-crumb-tree ph-no-capture"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-placed={String(placed)}
      style={{ ...at, width: TREE_BOUNDS.WIDTH }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Note that the Escape is stopped here, because the window's own would close the panel behind the tree.
        event.stopPropagation();
        latest.current.onClose(true);
      }}
    >
      {module === undefined ? (
        <p className="file-crumb-notice">
          {AsyncResult.isFailure(loaded) ? TREE_LOAD_FAILED : "Reading the files…"}
        </p>
      ) : (
        <div className="file-tree-host" ref={host} />
      )}
    </div>,
    document.body,
  );
}

/** The chevron before every crumb but the first: the path's punctuation and nothing more. */
function CrumbChevron(): React.JSX.Element {
  return (
    <span className="file-breadcrumb-separator" aria-hidden="true">
      <ChevronRightIcon />
    </span>
  );
}

/** How much of the path a "…" stands for: the folders between the repository and the file's own folder, or the repository and every folder. */
const FOLD = { MIDDLE: "middle", ALL: "all" } as const;

type Fold = (typeof FOLD)[keyof typeof FOLD];

/**
 * A "…" standing for crumbs a narrow bar leaves out, which names them in its
 * pill and hangs the tree the last of them would. It is drawn only on a bar
 * narrow enough to ask for it, in their place (planning.css).
 */
function FoldedCrumb({
  fold,
  folded,
  expanded,
  onOpen,
}: {
  fold: Fold;
  /** The names it stands for, in the path's order. */
  folded: readonly string[];
  expanded: boolean;
  onOpen: (opener: HTMLElement) => void;
}): React.JSX.Element {
  const names = folded.join("/");
  return (
    <li data-folded-crumb={fold}>
      {fold === FOLD.ALL ? null : <CrumbChevron />}
      <Tooltip label={names}>
        <button
          type="button"
          className="file-breadcrumb"
          aria-label={`${FOLDED_LABEL}: ${names}`}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          onClick={(event) => onOpen(event.currentTarget)}
        >
          …
        </button>
      </Tooltip>
    </li>
  );
}

export function FileBreadcrumbs({
  repository,
  path,
  listFolder,
  onOpen,
}: {
  /** The task's repository, `owner/name`, the first crumb. */
  repository: string;
  /** The tab's file, from the repository's root. */
  path: string;
  listFolder: ReadFolder;
  /** Opens a file chosen in a crumb's tree in the tab, or in a tab of its own where `newTab` asks. */
  onOpen: (path: string, newTab: boolean) => void;
}): React.JSX.Element {
  const segments = path.split("/");
  const [asked, setOpened] = useState<Opened | undefined>(undefined);
  // A tree opened over another file, the tab having moved on, is let go.
  const opened = asked?.path === path ? asked : undefined;

  const close = (returnFocus: boolean) => {
    if (returnFocus) opened?.opener.focus();
    setOpened(undefined);
  };

  // The repository roots its tree at the root; any other crumb at the folder it stands in.
  const open = (at: number, opener: HTMLElement, mark = at) => {
    if (opened?.opener === opener) return close(false);
    const depth = Math.max(0, at - 1);
    setOpened({
      path,
      at: mark,
      folder: folderOf(segments, depth),
      file: segments.slice(depth).join("/"),
      opener,
    });
  };

  // The folders between the repository and the file's own folder, which a narrow bar draws as the "…".
  const folders = segments.length - 1;
  const middle = Math.max(0, folders - 1);
  const crumb = (name: string, at: number) => (
    // Note that a crumb is keyed by the path it ends, since a name may stand twice in one.
    <li
      key={folderOf(segments, at)}
      data-crumb={at}
      data-middle={String(at >= 1 && at <= middle && middle > 1)}
      data-folder={String(at < segments.length && folders > 0)}
    >
      {at === 0 ? null : <CrumbChevron />}
      <button
        type="button"
        className="file-breadcrumb"
        aria-current={at === segments.length ? "page" : undefined}
        aria-haspopup="dialog"
        aria-expanded={opened?.at === at}
        onClick={(event) => open(at, event.currentTarget)}
      >
        {name}
      </button>
    </li>
  );

  return (
    <nav className="file-breadcrumbs" aria-label="Path">
      <ol>
        {folders > 0 ? (
          <FoldedCrumb
            fold={FOLD.ALL}
            folded={[repository, ...segments.slice(0, folders)]}
            expanded={opened?.at === FOLDED_ALL}
            onOpen={(opener) => open(folders, opener, FOLDED_ALL)}
          />
        ) : null}
        {crumb(repository, 0)}
        {middle > 1 ? (
          <FoldedCrumb
            fold={FOLD.MIDDLE}
            folded={segments.slice(0, middle)}
            expanded={opened?.at === FOLDED_MIDDLE}
            onOpen={(opener) => open(middle, opener, FOLDED_MIDDLE)}
          />
        ) : null}
        {segments.map((name, index) => crumb(name, index + 1))}
      </ol>
      {opened === undefined ? null : (
        <CrumbTree
          key={opened.at}
          label={opened.folder === "" ? repository : opened.folder}
          opened={opened}
          listFolder={listFolder}
          onOpen={onOpen}
          onClose={close}
        />
      )}
    </nav>
  );
}
