import {
  createFileTreeIconResolver,
  FileTree,
  type FileTreeRowDecorationRenderer,
  getBuiltInSpriteSheet,
} from "@pierre/trees";
import type {
  FileMark,
  FileTreeHandle,
  FileTreeModule,
  FileTreeProps,
  FileTypeIcon,
  ReadFolder,
  RevealOptions,
} from "./contract.js";
import {
  browseFolders,
  type FolderBrowser,
  markAlone,
  repositoryPath,
  treePath,
} from "./folder-browser.js";
import { dress, pressedToggle, rowDecoration } from "./row-marks.js";

/**
 * index.ts -- the file tree bundle: Pierre's tree mounted beside a File tab, listed a folder at a time, a file opened on its press.
 *
 * An entry of the renderer's build (`scripts/build.mjs`), imported by the
 * first File tab that shows its tree (`../bundle-loader.ts`), so the bundle every window parses
 * never carries Pierre, nor anything of the tree's own drawing. The root is
 * listed first, and the tab's words for why it could not be stand in the
 * tree's place, with the offer to list it again where that may help.
 * Pierre then draws the tree in a shadow root of its own, virtualised, so a
 * folder of thousands of entries draws only the rows in view; the panel's
 * look reaches it through the `--trees-*` properties the host element sets
 * (`styles/tasks.css`), which a shadow root inherits.
 *
 * A file opens on a press, or on Return where the tree's keyboard stands on
 * it, read off the row Pierre drew, since Pierre tells a selection and not
 * how it was made: ⌘ held opens it in a tab of its own. Note that Pierre
 * takes a ⌘-press as adding to its selection, which the tab's next reveal
 * puts back to the one file shown.
 *
 * Each file is drawn with its type's coloured icon (Pierre's complete set),
 * and a folder holding one folder alone shares its row, as `src/main` does
 * in an editor's explorer. The pane's search narrows the rows to those whose
 * path holds the query, through Pierre's own search: over the whole
 * repository, in a tree of its own, once the pane has handed its every
 * entry, and over the folders listed so far until then. Its filter shows
 * only the files Luke showed, in a tree of those paths alone, every folder
 * open. Each stands in the repository's place while it is asked for, so the
 * folders opened there are as they were when it is let go. A change set's
 * tree marks each file's row with what became of it, through Pierre's own
 * git status, in whichever of them stands, and a pull request's draws at
 * each file's row's end its review threads, its lines, and its Viewed
 * toggle (`row-marks.ts`), a press on which marks the file rather than
 * opening it, as V does on the row the tree's keyboard stands on.
 *
 * A breadcrumb's tree is this same tree, mounted under the crumb over the
 * folder the crumb stands in, with its rows counted out as they change so
 * its box stands as tall as they are.
 *
 * The bundle also names a file's type icon by its name alone, for a file
 * attached to a message, through Pierre's own resolver over the same set,
 * drawn from Pierre's sprite sheet added to the document once.
 */

/** What Pierre marks a row with: that it is an entry, and that it is a file. */
const ROW = {
  TYPE: "item",
  FILE: "file",
} as const;

/**
 * How both trees draw: compact rows, each file's type in colour, and a lone
 * folder sharing its parent's row; the rest of their look is the sheet each
 * is dressed in (`row-marks.ts`).
 */
const TREE_LOOK = {
  flattenEmptyDirectories: true,
  density: "compact",
  icons: "complete",
} as const;

/** The slot Pierre resolves a file's type icon for, and the type of a file no rule names. */
const FILE_ICON = {
  SLOT: "file-tree-icon-file",
  DEFAULT_TYPE: "default",
} as const;

/** The key that presses the Viewed toggle of the row the tree's keyboard stands on, as the list's V marks its file. */
const VIEWED_KEY = "v";

/** What the pane says while the root is listed. */
const READING = "Reading the files…";

/** What stands in the tree's place while a search matches nothing. */
const NO_MATCH = "No files match.";

/** What stands under the tree once a folder in it was listed short of whole. */
const CUT_SHORT =
  "Some folders hold more than the tree lists. Open them on GitHub to see the rest.";

/**
 * The retry's turning arrow, Lucide's `RotateCw` as `retry-button.tsx` draws
 * it. Note that its paths are written out here, because this bundle carries
 * no React and so cannot draw Lucide's component.
 */
const RETRY_GLYPH_PATHS = [
  "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8",
  "M21 3v5h-5",
] as const;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** The row element a press landed in, through the tree's shadow root. */
function pressedRow(event: Event): HTMLElement | undefined {
  return event
    .composedPath()
    .find(
      (target): target is HTMLElement =>
        target instanceof HTMLElement && target.dataset.type === ROW.TYPE,
    );
}

/** The retry's glyph, stroked in the button's colour like every Lucide glyph in the window. */
function retryGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("class", "lucide");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of RETRY_GLYPH_PATHS) {
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** The words standing in the tree's place, with a button that lists again where `retry` is given. */
function notice(text: string, retry: (() => void) | undefined): HTMLElement {
  const box = document.createElement("div");
  box.className = "file-tree-notice";
  const words = document.createElement("p");
  words.className = "m-0";
  words.textContent = text;
  box.append(words);
  if (retry === undefined) return box;
  box.setAttribute("role", "alert");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toolbar-button";
  button.append(retryGlyph(), "Retry");
  button.addEventListener("click", retry);
  box.append(button);
  return box;
}

/** One of the trees the pane shows, and the element it draws in, which is hidden while the other stands. */
interface View {
  readonly tree: FileTree;
  readonly frame: HTMLElement;
}

/** A tree drawn into a frame of its own over the paths given, Pierre's names for them, each row's end drawn by `decorate`. */
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

/** The entries a listing holds, or nothing where it holds why it is not one; `onCut` hears a listing cut short. */
function entriesOf(read: ReadFolder, onCut: () => void) {
  return (path: string) =>
    read(path).then((listed) => {
      if (!("entries" in listed)) return undefined;
      if (listed.truncated) onCut();
      return listed.entries;
    });
}

const iconResolver = createFileTreeIconResolver(TREE_LOOK.icons);

/** The sheet the type icons draw from, made the first time one is asked for. */
let spriteSheet: HTMLElement | undefined;

/**
 * A file's type icon, as the tree would draw the file, its sheet added to
 * the document wherever it is not there. Note that the sheet is held at no
 * size rather than hidden, because a symbol clipping itself through an id
 * draws nothing out of a sheet that is not displayed.
 */
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
  // The reveal asked before the tree is drawn.
  let waiting: { path: string; options: RevealOptions } | undefined;
  const empty = notice(NO_MATCH, undefined);
  // Note that the line saying a folder was cut short is added once, under the tree.
  const cut = notice(CUT_SHORT, undefined);
  cut.classList.add("file-tree-cut");

  // Each file's row ends as its mark says; a folder's says nothing more.
  const decorate: FileTreeRowDecorationRenderer = ({ item }) =>
    item.kind === "file" ? rowDecoration(markOf.get(repositoryPath(item.path))) : null;

  // The tree standing now, drawn with the search held: the files Luke
  // showed while the filter is on, the whole repository while a search
  // stands and it was handed, the folders listed so far otherwise; or the
  // words saying the search matches nothing.
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
  // A view made after the tree was drawn joins it, the tab's file marked.
  const framed = (view: View): View => {
    if (marked !== undefined) markAlone(view.tree, marked, false);
    view.tree.setGitStatus(marks);
    empty.before(view.frame);
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
    empty.hidden = !matchless;
  };

  const draw = () => {
    browse = viewOf([], "closed", decorate);
    browse.tree.setGitStatus(marks);
    empty.hidden = true;
    host.replaceChildren(browse.frame, empty);
    dress(browse.tree);
    // Note that a search stands over folders still being listed, so whether
    // it matches anything is asked again as each listing lands.
    const tree = browse.tree;
    unheard = tree.subscribe(() => {
      props.onRows?.(tree.getVisibleCount());
      if (query.trim() !== "") present();
    });
    browser = browseFolders(
      browse.tree,
      entriesOf(props.readFolder, () => {
        if (!cut.isConnected) host.append(cut);
      }),
    );
    if (waiting !== undefined) browser.reveal(waiting.path, waiting.options).catch(() => undefined);
    waiting = undefined;
    present();
  };

  const list = () => {
    host.replaceChildren(notice(READING, undefined));
    props.readFolder("").then((root) => {
      if (taken) return;
      if ("notice" in root)
        host.replaceChildren(notice(root.notice, root.retry ? list : undefined));
      else draw();
    });
  };

  const onClick = (event: MouseEvent) => {
    const row = pressedRow(event);
    const path = row?.dataset.itemPath;
    if (row?.dataset.itemType !== ROW.FILE || path === undefined) return;
    props.onOpen(repositoryPath(path), event.metaKey || event.ctrlKey);
  };
  // Note that a press on a Viewed toggle is heard on its way down, before
  // the row it stands in, so it goes no further: the row neither opens nor
  // takes the keyboard.
  const onToggle = (event: MouseEvent) => {
    const path = pressedToggle(event);
    if (path === undefined || props.onViewed === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "click") props.onViewed(repositoryPath(path));
  };
  // Note that V on a row whose toggle is drawn is that row's toggle, as
  // the list's own V is its file's, so it goes no further than the tree.
  const onKey = (event: KeyboardEvent) => {
    const path = standing()?.tree.getFocusedPath() ?? null;
    if (path === null || path.endsWith("/")) return;
    if (event.key === "Enter")
      return props.onOpen(repositoryPath(path), event.metaKey || event.ctrlKey);
    const plain = !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey);
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
      // Note that Pierre draws its rows again for a change of status alone,
      // so a change to what else a mark carries is drawn by asking it to.
      for (const view of [browse, shown, whole]) {
        if (view === undefined) continue;
        view.tree.setGitStatus(marks);
        view.tree.setComposition(view.tree.getComposition());
        dress(view.tree);
      }
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
