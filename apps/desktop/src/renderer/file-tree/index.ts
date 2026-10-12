import { FileTree } from "@pierre/trees";
import type {
  FileTreeHandle,
  FileTreeModule,
  FileTreeProps,
  ReadFolder,
  RevealOptions,
} from "./contract";
import { browseFolders, type FolderBrowser, repositoryPath } from "./folder-browser";

/**
 * index.ts -- the file tree bundle: Pierre's tree mounted beside a File tab, listed a folder at a time, a file opened on its press.
 *
 * Built on its own as `file-tree.js` (`scripts/build.mjs`) and loaded by the
 * first File tab that shows its tree, so the bundle every window parses
 * never carries Pierre, nor anything of the tree's own drawing. The root is
 * listed first, and the tab's words for why it could not be stand in the
 * tree's place, with the offer to list it again where that may help.
 * Pierre then draws the tree in a shadow root of its own, virtualised, so a
 * folder of thousands of entries draws only the rows in view; the panel's
 * look reaches it through the `--trees-*` properties the host element sets
 * (`styles/planning.css`), which a shadow root inherits.
 *
 * A file opens on a press, or on Return where the tree's keyboard stands on
 * it, read off the row Pierre drew, since Pierre tells a selection and not
 * how it was made: ⌘ held opens it in a tab of its own. Note that Pierre
 * takes a ⌘-press as adding to its selection, which the tab's next reveal
 * puts back to the one file shown.
 */

/** What Pierre marks a row with: that it is an entry, and that it is a file. */
const ROW = {
  TYPE: "item",
  FILE: "file",
} as const;

/** What the pane says while the root is listed. */
const READING = "Reading the files…";

/** The row element a press landed in, through the tree's shadow root. */
function pressedRow(event: Event): HTMLElement | undefined {
  return event
    .composedPath()
    .find(
      (target): target is HTMLElement =>
        target instanceof HTMLElement && target.dataset.type === ROW.TYPE,
    );
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
  button.textContent = "Try again";
  button.addEventListener("click", retry);
  box.append(button);
  return box;
}

/** The entries a listing holds, or nothing where it holds why it is not one. */
function entriesOf(read: ReadFolder) {
  return (path: string) =>
    read(path).then((listed) => ("entries" in listed ? listed.entries : undefined));
}

function mount(host: HTMLElement, props: FileTreeProps): FileTreeHandle {
  let tree: FileTree | undefined;
  let browser: FolderBrowser | undefined;
  let taken = false;
  // The reveals asked before the tree is drawn: the tab's file, and a folder a breadcrumb asked for.
  const waiting = new Map<boolean, { path: string; options: RevealOptions }>();

  const draw = () => {
    tree = new FileTree({
      paths: [],
      flattenEmptyDirectories: false,
      density: "compact",
      icons: "standard",
    });
    host.replaceChildren();
    tree.render({ containerWrapper: host });
    browser = browseFolders(tree, entriesOf(props.readFolder));
    for (const { path, options } of waiting.values()) {
      browser.reveal(path, options).catch(() => undefined);
    }
    waiting.clear();
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
  const onKey = (event: KeyboardEvent) => {
    const path = tree?.getFocusedPath() ?? null;
    if (event.key !== "Enter" || path === null || path.endsWith("/")) return;
    props.onOpen(repositoryPath(path), event.metaKey || event.ctrlKey);
  };
  host.addEventListener("click", onClick);
  host.addEventListener("keydown", onKey);
  list();

  return {
    reveal: (path, options) => {
      if (browser === undefined) waiting.set(options.folder, { path, options });
      else browser.reveal(path, options).catch(() => undefined);
    },
    unmount: () => {
      taken = true;
      host.removeEventListener("click", onClick);
      host.removeEventListener("keydown", onKey);
      browser?.dispose();
      tree?.cleanUp();
    },
  };
}

window.lukeFileTree = { mount } satisfies FileTreeModule;
