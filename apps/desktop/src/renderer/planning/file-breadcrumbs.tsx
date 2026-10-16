import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ChevronRightIcon } from "lucide-react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MENU_DROP } from "../desktop/action-menu";
import type { ReadFolder } from "../file-tree/contract";
import { Tooltip } from "../tooltip";
import { fileTreeModuleAtom, TREE_LOAD_FAILED } from "./file-tree-bundle";

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
 * Where the bar has too little room for the whole path, the folders give
 * way first, from the repository's side, then the repository, folded into
 * one "…" crumb that stands for the last of them and names them all in its
 * pill, so no crumb is ever squeezed to a sliver (`useCrumbFit`). Only with
 * every crumb but the file folded and still too little room does the file
 * give way, cut short at its end.
 */

/** What the "…" crumb is called, before the folders it stands for. */
const FOLDED_LABEL = "Folders";

/** How much of the path the "…" stands for: some folders or none, every folder, or every folder and the repository too. */
const FOLD = { SOME: "some", FOLDERS: "folders", ALL: "all" } as const;

/** The least room the repository's crumb is cut short to, with every folder folded, before it folds too. */
const REPOSITORY_LEAST = 64;

/** A row of the tree as the compact density draws it, which the box's height is counted in. */
const ROW_HEIGHT = 24;
/** The tallest a crumb's tree stands before it scrolls, its width, and the room it keeps from the window's edges. */
const TREE_BOUNDS = { MAX_HEIGHT: 360, WIDTH: 280, MARGIN: 8, INSET: 4 } as const;

/** A crumb's tree standing open: the tab's file it was opened over, and how many crumbs the bar had folded then; the crumb, by its place in the path; the folder the tree is rooted at; and the tab's file from that folder, which it reveals. */
interface Opened {
  readonly path: string;
  readonly folded: number;
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
  const loaded = useAtomValue(fileTreeModuleAtom);
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

/** Each crumb's width at full length, its chevron included, by its place in the path; and the "…" crumb's, with its own. */
interface CrumbWidths {
  readonly crumbs: readonly number[];
  readonly folded: number;
}

/** The crumbs' widths as the bar draws them with none folded. */
function crumbWidths(nav: HTMLElement): CrumbWidths {
  const width = (element: Element | null) => element?.getBoundingClientRect().width ?? 0;
  return {
    crumbs: [...nav.querySelectorAll("li[data-crumb]")].map(width),
    folded: width(nav.querySelector("li[data-folded-crumb]")),
  };
}

/** The room a bar leaves its breadcrumbs: its width less its padding, the other parts it holds, and the gaps between them. */
function crumbRoom(nav: HTMLElement): number {
  const bar = nav.parentElement;
  if (bar === null) return Number.POSITIVE_INFINITY;
  const style = getComputedStyle(bar);
  const others = [...bar.children].filter((child) => child !== nav);
  const taken = others.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
  const gaps = (Number.parseFloat(style.columnGap) || 0) * others.length;
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  return bar.clientWidth - padding - taken - gaps;
}

/**
 * How many crumbs to fold into the "…": the fewest that let the rest fit
 * `room`, taken first from the folders, from the repository's side, then
 * the repository itself, the file never. With every folder folded the
 * repository is cut short rather than folded while that leaves it some
 * room to be read in, and folded once it would not; the file is cut short
 * only with nothing left to fold.
 */
function foldedToFit(widths: CrumbWidths, room: number): number {
  const { crumbs } = widths;
  // The folders stand between the repository, first, and the file, last.
  const folders = Math.max(0, crumbs.length - 2);
  const order = [...Array.from({ length: folders }, (_, at) => at + 1), 0];
  let total = crumbs.reduce((sum, width) => sum + width, 0);
  for (const [folded, at] of order.entries()) {
    if (total <= room) return folded;
    if (at === 0 && room - (total - (crumbs[0] ?? 0)) >= REPOSITORY_LEAST) return folded;
    total -= crumbs[at] ?? 0;
    if (folded === 0) total += widths.folded;
  }
  return order.length;
}

/**
 * How many crumbs the bar folds, for the repository and path they were
 * fitted to. Each crumb is measured at full length once a path, on the
 * frame it is first drawn with none folded, and the fold is counted again
 * from those widths whenever the bar changes its size and after every
 * render, since what stands beside the path, a commit or a change's
 * counts, may have taken or given room; so no crumb is drawn squeezed and
 * the path is never drawn whole again just to be measured.
 */
function useCrumbFit(nav: RefObject<HTMLElement | null>, repository: string, path: string): number {
  const [fit, setFit] = useState({ repository, path, folded: 0 });
  const widths = useRef<CrumbWidths | undefined>(undefined);
  // Note that a count that has not changed keeps the state it has, so the refit after a render renders nothing more.
  const refit = useCallback(() => {
    const element = nav.current;
    const measured = widths.current;
    if (element === null || measured === undefined) return;
    const folded = foldedToFit(measured, crumbRoom(element));
    setFit((was) =>
      was.repository === repository && was.path === path && was.folded === folded
        ? was
        : { repository, path, folded },
    );
  }, [nav, repository, path]);
  useLayoutEffect(() => {
    const element = nav.current;
    const bar = element?.parentElement;
    if (element === null || bar === null || bar === undefined) return undefined;
    widths.current = crumbWidths(element);
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [nav, refit]);
  useLayoutEffect(refit);
  return fit.repository === repository && fit.path === path ? fit.folded : 0;
}

/** How much of a path of `folders` folders the "…" stands for, with `folded` crumbs folded into it. */
function foldOf(folded: number, folders: number): (typeof FOLD)[keyof typeof FOLD] {
  if (folded > folders) return FOLD.ALL;
  return folded === folders ? FOLD.FOLDERS : FOLD.SOME;
}

/** The chevron before every crumb but the first: the path's punctuation and nothing more. */
function CrumbChevron(): React.JSX.Element {
  return (
    <span className="file-breadcrumb-separator" aria-hidden="true">
      <ChevronRightIcon />
    </span>
  );
}

/**
 * The "…" standing for the crumbs folded out of the bar, which names them
 * in its pill and hangs the tree the last of them would. With nothing
 * folded it is still laid out, out of sight and out of reach, so its width
 * is there to be measured.
 */
function FoldedCrumb({
  folded,
  first,
  expanded,
  onOpen,
}: {
  /** The names it stands for, the repository's first where it is folded too. */
  folded: readonly string[];
  /** Whether it begins the path, the repository folded into it. */
  first: boolean;
  expanded: boolean;
  onOpen: (opener: HTMLElement) => void;
}): React.JSX.Element {
  const names = folded.join("/");
  const standing = folded.length > 0;
  return (
    <li data-folded-crumb={String(standing)} aria-hidden={!standing} inert={!standing}>
      {first ? null : <CrumbChevron />}
      <Tooltip label={standing ? names : undefined}>
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
  /** The plan's repository, `owner/name`, the first crumb. */
  repository: string;
  /** The tab's file, from the repository's root. */
  path: string;
  listFolder: ReadFolder;
  /** Opens a file chosen in a crumb's tree in the tab, or in a tab of its own where `newTab` asks. */
  onOpen: (path: string, newTab: boolean) => void;
}): React.JSX.Element {
  const segments = path.split("/");
  const nav = useRef<HTMLElement>(null);
  const folded = useCrumbFit(nav, repository, path);
  const [asked, setOpened] = useState<Opened | undefined>(undefined);
  // A tree opened over another file, the tab having moved on, or before the
  // bar folded its crumbs again, its own crumb perhaps folded away, is let go.
  const opened = asked?.path === path && asked.folded === folded ? asked : undefined;

  const close = (returnFocus: boolean) => {
    if (returnFocus) opened?.opener.focus();
    setOpened(undefined);
  };

  // The repository roots its tree at the root; any other crumb at the folder it stands in.
  const open = (at: number, opener: HTMLElement) => {
    if (opened?.opener === opener) return close(false);
    const depth = Math.max(0, at - 1);
    setOpened({
      path,
      folded,
      at,
      folder: folderOf(segments, depth),
      file: segments.slice(depth).join("/"),
      opener,
    });
  };

  const crumb = (name: string, at: number) => (
    // Note that a crumb is keyed by the path it ends, since a name may stand twice in one.
    <li key={folderOf(segments, at)} data-crumb={at}>
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

  // The folders stand between the repository and the file; those folded,
  // and then the repository, give way to the "…", which hangs the tree the
  // last of them would.
  const folders = segments.length - 1;
  const repositoryFolded = folded > folders;
  const foldedFolders = Math.min(folded, folders);
  return (
    <nav
      ref={nav}
      className="file-breadcrumbs"
      aria-label="Path"
      data-fold={foldOf(folded, folders)}
    >
      <ol>
        {repositoryFolded ? null : crumb(repository, 0)}
        <FoldedCrumb
          folded={[...(repositoryFolded ? [repository] : []), ...segments.slice(0, foldedFolders)]}
          first={repositoryFolded}
          expanded={folded > 0 && opened?.at === foldedFolders}
          onOpen={(opener) => open(foldedFolders, opener)}
        />
        {segments.map((name, index) => (index < foldedFolders ? null : crumb(name, index + 1)))}
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
