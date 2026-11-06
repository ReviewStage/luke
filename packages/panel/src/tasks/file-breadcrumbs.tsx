import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  BREADCRUMB_POPUP,
  BREADCRUMB_SHOWN,
  type BreadcrumbShown,
  Breadcrumbs,
  type Crumb,
  MenuSurface,
  POPOVER_SIDE,
  RectFloat,
} from "@repo/ui";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef, useState } from "react";
import { useSideBundles } from "../bundle-loader.js";
import type { FileTreeHandle, ReadFolder, TreeStanding } from "../file-tree/contract.js";
import { useHeldThroughExit } from "../use-held-through-exit.js";
import { FileTreeStage, TREE_READING } from "./file-tree-pane.js";

const FOLDED_LABEL = "Folders";

const FOLDED_MIDDLE = -1;
const FOLDED_ALL = -2;

const ROW_HEIGHT = 24;
const TREE_BOUNDS = { MAX_HEIGHT: 360, INSET: 4 } as const;

interface Opened {
  readonly path: string;
  readonly at: number;
  readonly folder: string;
  readonly file: string;
  readonly opener: HTMLElement;
}

function folderOf(segments: readonly string[], count: number): string {
  return segments.slice(0, count).join("/");
}

function fromRoot(folder: string, path: string): string {
  if (folder === "" || path === "") return folder === "" ? path : folder;
  return `${folder}/${path}`;
}

function CrumbTree({
  label,
  opened,
  open,
  listFolder,
  onOpen,
  onClose,
  onExited,
}: {
  label: string;
  opened: Opened;
  open: boolean;
  listFolder: ReadFolder;
  onOpen: (path: string, newTab: boolean) => void;
  onClose: (returnFocus: boolean) => void;
  onExited: () => void;
}): React.JSX.Element {
  const { fileTree } = useSideBundles();
  const loaded = useAtomValue(fileTree);
  const retryBundle = useAtomRefresh(fileTree);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<FileTreeHandle | undefined>(undefined);
  const [rows, setRows] = useState<number | undefined>(undefined);
  const [standing, setStanding] = useState<TreeStanding>(TREE_READING);
  const latest = useRef({ listFolder, onOpen, onClose });
  latest.current = { listFolder, onOpen, onClose };
  const { folder, file, opener } = opened;
  const height =
    rows === undefined
      ? undefined
      : Math.min(rows * ROW_HEIGHT + 2 * TREE_BOUNDS.INSET, TREE_BOUNDS.MAX_HEIGHT);

  useEffect(() => {
    const element = box.current;
    if (element === null || element.contains(document.activeElement)) return;
    element.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    const tree = module.mount(element, {
      readFolder: (path) => latest.current.listFolder(fromRoot(folder, path)),
      onStanding: setStanding,
      onOpen: (path, newTab) => {
        latest.current.onClose(false);
        latest.current.onOpen(fromRoot(folder, path), newTab);
      },
      onRows: setRows,
    });
    handle.current = tree;
    tree.reveal(file, { focus: true });
    return () => {
      handle.current = undefined;
      tree.unmount();
    };
  }, [module, folder, file]);

  useEffect(() => {
    const leave = () => latest.current.onClose(false);
    const bar = opener.closest(".ui-pane-bar");
    let first = true;
    const folded = new ResizeObserver(() => {
      if (first) first = false;
      else leave();
    });
    if (bar !== null) folded.observe(bar);
    window.addEventListener("blur", leave);
    window.addEventListener("resize", leave);
    return () => {
      folded.disconnect();
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", leave);
    };
  }, [opener]);

  return (
    <RectFloat
      open={open}
      onExited={onExited}
      anchor={() => opener.getBoundingClientRect()}
      side={POPOVER_SIDE.BELOW}
      onPressAway={() => latest.current.onClose(false)}
      holds={(target) => opener.contains(target)}
    >
      <MenuSurface
        ref={box}
        className="file-crumb-tree ph-no-capture max-h-crumb-tree w-popover-narrow"
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        style={height === undefined ? undefined : { height }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          latest.current.onClose(true);
        }}
      >
        <FileTreeStage
          module={module}
          missed={AsyncResult.isFailure(loaded)}
          host={host}
          standing={standing}
          onRetry={() => handle.current?.relist()}
          onRetryBundle={retryBundle}
        />
      </MenuSurface>
    </RectFloat>
  );
}

export function FileBreadcrumbs({
  repository,
  path,
  listFolder,
  onOpen,
}: {
  repository: string;
  path: string;
  listFolder: ReadFolder;
  onOpen: (path: string, newTab: boolean) => void;
}): React.JSX.Element {
  const segments = path.split("/");
  const [asked, setOpened] = useState<Opened | undefined>(undefined);
  const opened = asked?.path === path ? asked : undefined;
  const { held, onExited } = useHeldThroughExit(opened);

  const close = (returnFocus: boolean) => {
    if (returnFocus) opened?.opener.focus();
    setOpened(undefined);
  };

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

  const folders = segments.length - 1;
  const middle = Math.max(0, folders - 1);
  const deep = folders >= 6;
  const folded = (names: readonly string[], shownAt: BreadcrumbShown, mark: number, at: number) => {
    const named = names.join("/");
    return {
      label: "…",
      name: `${FOLDED_LABEL}: ${named}`,
      hint: named,
      shownAt,
      popup: BREADCRUMB_POPUP.DIALOG,
      expanded: opened?.at === mark,
      onPress: (opener: HTMLElement) => open(at, opener, mark),
    } satisfies Crumb;
  };
  const crumb = (name: string, at: number, shownAt: BreadcrumbShown): Crumb => ({
    label: name,
    current: at === segments.length,
    shownAt,
    popup: BREADCRUMB_POPUP.DIALOG,
    expanded: opened?.at === at,
    onPress: (opener) => open(at, opener),
  });
  const crumbs: Crumb[] = [];
  if (folders > 0) {
    crumbs.push(
      folded(
        [repository, ...segments.slice(0, folders)],
        BREADCRUMB_SHOWN.NARROWEST,
        FOLDED_ALL,
        folders,
      ),
    );
  }
  crumbs.push(
    crumb(repository, 0, folders > 0 ? BREADCRUMB_SHOWN.WIDE_OR_NARROW : BREADCRUMB_SHOWN.ALWAYS),
  );
  if (middle > 1) {
    const shownAt = deep ? BREADCRUMB_SHOWN.WIDE_OR_NARROW : BREADCRUMB_SHOWN.NARROW;
    crumbs.push(folded(segments.slice(0, middle), shownAt, FOLDED_MIDDLE, middle));
  }
  segments.forEach((name, index) => {
    const at = index + 1;
    const inMiddle = at <= middle && middle > 1;
    if (at === segments.length) crumbs.push(crumb(name, at, BREADCRUMB_SHOWN.ALWAYS));
    else if (!inMiddle) crumbs.push(crumb(name, at, BREADCRUMB_SHOWN.WIDE_OR_NARROW));
    else if (!deep) crumbs.push(crumb(name, at, BREADCRUMB_SHOWN.WIDE));
  });

  return (
    <>
      <Breadcrumbs label="Path" crumbs={crumbs} />
      {held === undefined ? null : (
        <CrumbTree
          key={held.at}
          label={held.folder === "" ? repository : held.folder}
          opened={held}
          open={opened !== undefined}
          listFolder={listFolder}
          onOpen={onOpen}
          onClose={close}
          onExited={onExited}
        />
      )}
    </>
  );
}
