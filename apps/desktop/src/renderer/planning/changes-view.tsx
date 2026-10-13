import { useAtomValue } from "@effect/atom-react";
import type { CodingAgentChangedFile } from "@sidecar/hosted/coding-agent-wire";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { FileDiffIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GitHubMark } from "../account-marks";
import { EmptyState } from "../empty-state";
import type { FileTreeHandle } from "../file-tree/contract";
import { RetryButton } from "../retry-button";
import { SpinnerRegion } from "../spinner";
import { Tooltip } from "../tooltip";
import {
  CHANGES_READ,
  CHANGES_WORDS,
  type ChangesRead,
  changeTotals,
  chosenFile,
  DIFF_ROW,
  type DiffHunk,
  fileCountLabel,
  fileNotice,
  patchHunks,
  STATUS_LETTER,
} from "./changes-model";
import { fileTreeModuleAtom, TREE_LOAD_FAILED } from "./file-tree-bundle";

/**
 * changes-view.tsx -- a change set drawn as an editor's source control draws one: the chosen file's unified diff, beside the tree of every changed file.
 *
 * The view is the one every source of changes feeds: it is handed where a
 * read stands (`changes-model.ts`) and a door to read again, and knows
 * nothing of where the files came from. A read still out draws the wait; a
 * failed one says so with a retry; one with nothing to read yet says why;
 * a change set with no files says that. Otherwise a bar over both panes
 * counts the files and the lines they add and remove, with a refresh and,
 * where the source has a page, a door to it; the diff takes the room the
 * tree leaves, and the tree keeps to the right, as a File tab's does.
 *
 * The tree is the file tree bundle's own (`../file-tree/`), mounted over no
 * folder and narrowed to the changed files with every folder above them
 * opened, so it draws the same rows a File tab's does; choosing a file
 * there shows its diff. The diff is every hunk under its `@@` header, each
 * row numbered on the side it stands on, added rows and removed ones
 * marked; a file with no patch says why in its place. Every name and line
 * here is the repository's, so the view is left out of the screen
 * recording (`ph-no-capture`).
 */

/** A root that lists nothing, so the tree draws only the changed files it is narrowed to. */
const NO_FOLDER = Promise.resolve({ entries: [], truncated: false });

/** The tree of changed files: the bundle's tree narrowed to them, the shown file marked; a choice there shows another. */
function ChangedFilesTree({
  paths,
  chosen,
  onChoose,
}: {
  paths: readonly string[];
  chosen: string | undefined;
  onChoose: (path: string) => void;
}): React.JSX.Element {
  const loaded = useAtomValue(fileTreeModuleAtom);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<FileTreeHandle | undefined>(undefined);
  // What the mounted tree was last handed, so a draw hands it only what changed.
  const applied = useRef<{ paths?: readonly string[] | undefined; chosen?: string | undefined }>(
    {},
  );
  // Note that the tree is handed doors that read the latest props, so it is
  // mounted once however often the view is drawn.
  const latest = useRef({ paths, chosen, onChoose });
  latest.current = { paths, chosen, onChoose };

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    const mounted = module.mount(element, {
      readFolder: () => NO_FOLDER,
      onOpen: (path) => latest.current.onChoose(path),
    });
    handle.current = mounted;
    applied.current = {};
    return () => {
      handle.current = undefined;
      mounted.unmount();
    };
  }, [module]);

  useEffect(() => {
    const mounted = handle.current;
    if (mounted === undefined) return;
    if (applied.current.paths !== paths) mounted.only(paths);
    if (chosen !== undefined && applied.current.chosen !== chosen) {
      mounted.reveal(chosen, { focus: false });
    }
    applied.current = { paths, chosen };
  }, [module, paths, chosen]);

  return (
    <aside className="file-tree-pane changes-tree ph-no-capture" aria-label="Changed files">
      {module === undefined ? (
        <p className="file-tree-notice">
          {AsyncResult.isFailure(loaded) ? TREE_LOAD_FAILED : "Reading the files…"}
        </p>
      ) : (
        <div className="file-tree-host" ref={host} />
      )}
    </aside>
  );
}

/** One hunk: its header across both gutters, then its rows, each numbered on the side it stands on. */
function HunkRows({ hunk }: { hunk: DiffHunk }): React.JSX.Element {
  return (
    <>
      <div className="diff-hunk-header">
        <span className="diff-line-number" />
        <span className="diff-line-number" />
        <span className="diff-line-text">{hunk.header}</span>
      </div>
      {hunk.rows.map((row, index) => (
        // Note that a hunk's rows never move within it, so their place is their key.
        <div key={index} className="diff-line" data-kind={row.kind}>
          <span className="diff-line-number">{row.oldLine}</span>
          <span className="diff-line-number">{row.newLine}</span>
          <span className="diff-line-text">
            {row.kind === DIFF_ROW.NOTE ? row.text.trim() : row.text}
          </span>
        </div>
      ))}
    </>
  );
}

/** The chosen file: its path, where it moved from, what became of it, its lines added and removed, and its diff or why there is none. */
function FileDiff({ file }: { file: CodingAgentChangedFile }): React.JSX.Element {
  const notice = fileNotice(file);
  const hunks = useMemo(
    () => (notice === undefined && file.patch !== null ? patchHunks(file.patch) : []),
    [file.patch, notice],
  );
  return (
    <section className="changes-diff file-tab" aria-label={`Diff of ${file.path}`}>
      <header className="changes-diff-head">
        <span className="changes-status" data-status={file.status}>
          {STATUS_LETTER[file.status]}
        </span>
        <span className="changes-diff-path">
          <bdi>
            {file.previousPath === null ? file.path : `${file.previousPath} → ${file.path}`}
          </bdi>
        </span>
        <span className="agent-published-lines">
          <span className="agent-published-added">+{file.additions}</span>{" "}
          <span className="agent-published-removed">−{file.deletions}</span>
        </span>
      </header>
      {notice !== undefined ? (
        <p className="changes-notice" data-changes-notice="">
          {notice}
        </p>
      ) : (
        <div className="file-tab-lines diff-lines">
          {hunks.map((hunk, index) => (
            <HunkRows key={index} hunk={hunk} />
          ))}
        </div>
      )}
    </section>
  );
}

/** A state that stands in both panes' place: the wait, a failure with its retry, or a line saying why there is nothing. */
function ChangesState({
  read,
  onRetry,
}: {
  read: Exclude<ChangesRead, { kind: typeof CHANGES_READ.READY }>;
  onRetry: () => void;
}): React.JSX.Element {
  switch (read.kind) {
    case CHANGES_READ.READING:
      return <SpinnerRegion label={CHANGES_WORDS.READING} />;
    case CHANGES_READ.FAILED:
      return (
        <div className="changes-failed">
          <p className="m-0" role="alert">
            {CHANGES_WORDS.FAILED}
          </p>
          <RetryButton onRetry={onRetry} />
        </div>
      );
    case CHANGES_READ.UNAVAILABLE:
      return <EmptyState icon={<FileDiffIcon />}>{CHANGES_WORDS.UNAVAILABLE[read.why]}</EmptyState>;
  }
}

export function ChangesView({
  read,
  refreshing,
  onRefresh,
  pageUrl,
  openGitHub,
}: {
  read: ChangesRead;
  /** Whether a read is out while the files drawn still stand. */
  refreshing: boolean;
  /** Reads the changes again, as Retry and Refresh both ask. */
  onRefresh: () => void;
  /** The source's own page of the changes, such as the pull request's files on GitHub; none where it has none. */
  pageUrl: string | undefined;
  openGitHub: (url: string) => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const files = read.kind === CHANGES_READ.READY ? read.changes.files : [];
  // Note that the list is kept while the change set is the same one, because
  // a fresh list would have the tree draw itself anew.
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  if (read.kind !== CHANGES_READ.READY) {
    return (
      <div className="changes-view">
        <ChangesState read={read} onRetry={onRefresh} />
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="changes-view">
        <EmptyState icon={<FileDiffIcon />}>{CHANGES_WORDS.EMPTY}</EmptyState>
      </div>
    );
  }
  const shown = chosenFile(files, chosen);
  const totals = changeTotals(files);
  return (
    <div className="changes-view file-view ph-no-capture">
      <header className="file-view-bar">
        <span className="changes-count">{fileCountLabel(files.length)}</span>
        <span className="agent-published-lines">
          <span className="agent-published-added">+{totals.additions}</span>{" "}
          <span className="agent-published-removed">−{totals.deletions}</span>
        </span>
        <div className="file-view-actions">
          {pageUrl === undefined ? null : (
            <Tooltip label="Open on GitHub">
              <button
                type="button"
                className="icon-button"
                aria-label="Open on GitHub"
                onClick={() => openGitHub(pageUrl)}
              >
                <GitHubMark />
              </button>
            </Tooltip>
          )}
          <Tooltip label="Refresh">
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh changes"
              aria-busy={refreshing}
              disabled={refreshing}
              onClick={onRefresh}
            >
              <RotateCwIcon aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </header>
      {read.changes.truncated ? (
        <p className="changes-truncated" data-changes-truncated="">
          {CHANGES_WORDS.TRUNCATED}
        </p>
      ) : null}
      <div className="file-view-body">
        {shown === undefined ? null : <FileDiff key={shown.path} file={shown} />}
        <ChangedFilesTree paths={paths} chosen={shown?.path} onChoose={setChosen} />
      </div>
    </div>
  );
}
