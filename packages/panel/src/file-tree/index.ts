import {
  createFileTreeIconResolver,
  FileTree,
  type FileTreeRowDecorationRenderer,
  getBuiltInSpriteSheet,
} from "@pierre/trees";
import {
  type FileMark,
  type FileTreeHandle,
  type FileTreeModule,
  type FileTreeProps,
  type FileTypeIcon,
  type ReadFolder,
  type RevealOptions,
  TREE_STANDING,
  type TreeStanding,
} from "./contract.js";
import {
  browseFolders,
  type FolderBrowser,
  keepMarked,
  markAlone,
  repositoryPath,
  treePath,
} from "./folder-browser.js";
import { dress, pressedToggle, rowDecoration } from "./row-marks.js";

const ROW = {
  TYPE: "item",
  FILE: "file",
} as const;

const TREE_LOOK = {
  flattenEmptyDirectories: true,
  density: "compact",
  icons: "complete",
} as const;

const FILE_ICON = {
  SLOT: "file-tree-icon-file",
  DEFAULT_TYPE: "default",
} as const;

const VIEWED_KEY = "v";

function pressedRow(event: Event): HTMLElement | undefined {
  return event
    .composedPath()
    .find(
      (target): target is HTMLElement =>
        target instanceof HTMLElement && target.dataset.type === ROW.TYPE,
    );
}

interface View {
  readonly tree: FileTree;
  readonly frame: HTMLElement;
}

function viewOf(
  paths: readonly string[],
  expansion: "open" | "closed",
  decorate: FileTreeRowDecorationRenderer,
): View {
  const tree = new FileTree({
    ...TREE_LOOK,
    paths,
    initialExpansion: expansion,
    renderRowDecoration: decorate,
  });
  const frame = document.createElement("div");
  frame.className = "file-tree-view";
  tree.render({ containerWrapper: frame });
  return { tree, frame };
}

function entriesOf(read: ReadFolder, onCut: () => void) {
  return (path: string) =>
    read(path).then((listed) => {
      if (!("entries" in listed)) return undefined;
      if (listed.truncated) onCut();
      return listed.entries;
    });
}

function sameStanding(told: TreeStanding, standing: TreeStanding): boolean {
  if (told.kind !== standing.kind) return false;
  if (told.kind === TREE_STANDING.FAILED && standing.kind === TREE_STANDING.FAILED)
    return told.notice === standing.notice && told.retry === standing.retry;
  if ("cut" in told && "cut" in standing) return told.cut === standing.cut;
  return true;
}

const iconResolver = createFileTreeIconResolver(TREE_LOOK.icons);

let spriteSheet: HTMLElement | undefined;

function fileIcon(name: string): FileTypeIcon {
  if (spriteSheet === undefined) {
    spriteSheet = document.createElement("div");
    spriteSheet.setAttribute("aria-hidden", "true");
    spriteSheet.style.position = "absolute";
    spriteSheet.style.width = "0";
    spriteSheet.style.height = "0";
    spriteSheet.style.overflow = "hidden";
    spriteSheet.innerHTML = getBuiltInSpriteSheet(TREE_LOOK.icons);
  }
  if (!spriteSheet.isConnected) document.body.append(spriteSheet);
  const icon = iconResolver.resolveIcon(FILE_ICON.SLOT, name);
  return { symbol: icon.name, type: icon.token ?? FILE_ICON.DEFAULT_TYPE };
}

function mount(host: HTMLElement, props: FileTreeProps): FileTreeHandle {
  let browse: View | undefined;
  let browser: FolderBrowser | undefined;
  let unheard: (() => void) | undefined;
  let shown: View | undefined;
  let only: readonly string[] | undefined;
  let whole: View | undefined;
  let everything: readonly string[] | undefined;
  let query = "";
  let marked: string | undefined;
  let marks: readonly FileMark[] = [];
  let markOf = new Map<string, FileMark>();
  let taken = false;
  let waiting: { path: string; options: RevealOptions } | undefined;
  let listing = false;
  let cut = false;
  let told: TreeStanding | undefined;

  const tell = (standing: TreeStanding) => {
    if (told !== undefined && sameStanding(told, standing)) return;
    told = standing;
    props.onStanding(standing);
  };

  const decorate: FileTreeRowDecorationRenderer = ({ item }) =>
    item.kind === "file" ? rowDecoration(markOf.get(repositoryPath(item.path))) : null;

  const standing = (): View | undefined => {
    if (browse === undefined) return undefined;
    if (only !== undefined) {
      shown ??= framed(viewOf(only, "open", decorate));
      return shown;
    }
    if (query.trim() === "" || everything === undefined) return browse;
    whole ??= framed(viewOf(everything, "closed", decorate));
    return whole;
  };
  const framed = (view: View): View => {
    if (marked !== undefined) markAlone(view.tree, marked, false);
    view.tree.setGitStatus(marks);
    host.append(view.frame);
    dress(view.tree);
    return view;
  };
  const present = () => {
    const view = standing();
    if (view === undefined) return;
    view.tree.setSearch(query === "" ? null : query);
    const matchless = query.trim() !== "" && view.tree.getSearchMatchingPaths().length === 0;
    for (const each of [browse, shown, whole]) {
      if (each !== undefined) each.frame.hidden = each !== view || matchless;
    }
    tell({ kind: matchless ? TREE_STANDING.NO_MATCH : TREE_STANDING.DRAWN, cut });
  };

  const draw = () => {
    browse = viewOf([], "closed", decorate);
    browse.tree.setGitStatus(marks);
    host.replaceChildren(browse.frame);
    dress(browse.tree);
    const tree = browse.tree;
    unheard = tree.subscribe(() => {
      props.onRows?.(tree.getVisibleCount());
      if (query.trim() !== "") present();
    });
    browser = browseFolders(
      browse.tree,
      entriesOf(props.readFolder, () => {
        cut = true;
        present();
      }),
    );
    if (waiting !== undefined) browser.reveal(waiting.path, waiting.options).catch(() => undefined);
    waiting = undefined;
    present();
  };

  const list = () => {
    listing = true;
    host.replaceChildren();
    tell({ kind: TREE_STANDING.READING });
    props.readFolder("").then((root) => {
      listing = false;
      if (taken) return;
      if ("notice" in root)
        tell({ kind: TREE_STANDING.FAILED, notice: root.notice, retry: root.retry });
      else draw();
    });
  };

  const onClick = (event: MouseEvent) => {
    const row = pressedRow(event);
    const path = row?.dataset.itemPath;
    const apart = event.metaKey || event.ctrlKey;
    const view = standing();
    if (apart && view !== undefined) keepMarked(view.tree, marked);
    if (row?.dataset.itemType !== ROW.FILE || path === undefined) return;
    props.onOpen(repositoryPath(path), apart);
  };
  const onToggle = (event: MouseEvent) => {
    const path = pressedToggle(event);
    if (path === undefined || props.onViewed === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "click") props.onViewed(repositoryPath(path));
  };
  const onKey = (event: KeyboardEvent) => {
    const path = standing()?.tree.getFocusedPath() ?? null;
    if (path === null || path.endsWith("/")) return;
    if (event.key === "Enter")
      return props.onOpen(repositoryPath(path), event.metaKey || event.ctrlKey);
    const plain =
      !event.isComposing && !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey);
    const toggles = markOf.get(repositoryPath(path))?.viewed !== undefined;
    if (
      !plain ||
      event.key.toLowerCase() !== VIEWED_KEY ||
      !toggles ||
      props.onViewed === undefined
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.onViewed(repositoryPath(path));
  };
  host.addEventListener("mousedown", onToggle, true);
  host.addEventListener("click", onToggle, true);
  host.addEventListener("click", onClick);
  host.addEventListener("keydown", onKey);
  list();

  return {
    reveal: (path, options) => {
      marked = path;
      for (const view of [shown, whole]) if (view !== undefined) markAlone(view.tree, path, false);
      if (browser === undefined) waiting = { path, options };
      else browser.reveal(path, options).catch(() => undefined);
    },
    search: (asked) => {
      query = asked;
      present();
    },
    only: (paths) => {
      shown?.tree.cleanUp();
      shown?.frame.remove();
      shown = undefined;
      only = paths;
      present();
    },
    within: (entries) => {
      whole?.tree.cleanUp();
      whole?.frame.remove();
      whole = undefined;
      everything = entries.map((entry) => treePath(entry.name, entry.folder));
      present();
    },
    mark: (asked) => {
      marks = asked;
      markOf = new Map(asked.map((mark) => [mark.path, mark]));
      for (const view of [browse, shown, whole]) {
        if (view === undefined) continue;
        view.tree.setGitStatus(marks);
        view.tree.setComposition(view.tree.getComposition());
        dress(view.tree);
      }
    },
    relist: () => {
      if (browse !== undefined || listing || taken) return;
      list();
    },
    unmount: () => {
      taken = true;
      host.removeEventListener("mousedown", onToggle, true);
      host.removeEventListener("click", onToggle, true);
      host.removeEventListener("click", onClick);
      host.removeEventListener("keydown", onKey);
      unheard?.();
      browser?.dispose();
      for (const view of [browse, shown, whole]) view?.tree.cleanUp();
    },
  };
}

export const fileTree: FileTreeModule = { mount, fileIcon };
