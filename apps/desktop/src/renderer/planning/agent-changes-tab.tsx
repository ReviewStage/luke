import { useAtomValue } from "@effect/atom-react";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChangesAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentChangedFile,
} from "@sidecar/hosted/coding-agent-wire";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { FileDiffIcon, RotateCwIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { GitHubMark } from "../account-marks";
import { useAct } from "../act";
import { EmptyState } from "../empty-state";
import type { FileTreeHandle } from "../file-tree/contract";
import { RetryButton } from "../retry-button";
import { SpinnerRegion } from "../spinner";
import { Tooltip } from "../tooltip";
import { LinesChanged } from "./agent-published";
import { CHANGES_WORDS, DIFF_ROW, fileNotice, patchHunks, STATUS_LETTER } from "./changes-model";
import { BLANK_LINE_TEXT } from "./code-pane";
import { agentStillWriting, agentTabLabel } from "./coding-agent-model";
import { fileTreeModuleAtom, TREE_LOAD_FAILED } from "./file-tree-bundle";
import type { CodingAgentsControl } from "./use-coding-agents";

/**
 * agent-changes-tab.tsx -- one agent's Changes tab in the side panel: its pull request's files drawn as an editor's source control draws a change set, the chosen file's unified diff beside the tree of every changed file.
 *
 * The files are read from GitHub afresh by the service on each ask, so
 * nothing here reads on a clock: the tab asks as it first comes on screen,
 * when the developer presses Retry or Refresh, and the moment the agent
 * ends, since that is when what it published has settled. A refresh leaves
 * the files drawn standing until its answer lands; a read that failed says
 * so with a retry; an agent with no pull request yet, or one whose pull
 * request changes nothing, says that. The panel keys the tab by its agent,
 * so one agent's answer is never drawn in another's tab.
 *
 * Otherwise a bar over both panes counts the files and the lines they add
 * and remove, with the pull request's files on GitHub and a refresh; the
 * diff takes the room the tree leaves, and the tree keeps to the right, as
 * a File tab's does. The tree is the file tree bundle's own
 * (`../file-tree/`), mounted over no folder and narrowed to the changed
 * files with every folder above them opened, so it draws the same rows a
 * File tab's does; choosing a file there shows its diff. Every name and
 * line here is the repository's, so the tab is left out of the screen
 * recording (`ph-no-capture`).
 */

/** A root that lists nothing, so the tree draws only the changed files it is narrowed to. */
const NO_FOLDER = Promise.resolve({ entries: [], truncated: false });

/** A read that threw rather than answered, drawn as any other failed read. */
const UNANSWERED: CodingAgentChangesAnswerView = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };

/**
 * The agent's changes as last answered, none before the first read lands;
 * whether a read is out; and the door that reads them again. Every ask is
 * numbered, so only the latest one's answer is drawn.
 */
function useChangesRead(
  agentId: string,
  shown: boolean,
  ended: boolean,
  read: CodingAgentsControl["readChanges"],
) {
  const [answer, setAnswer] = useState<CodingAgentChangesAnswerView | undefined>(undefined);
  const [out, setOut] = useState(false);
  const latest = useRef(read);
  latest.current = read;
  const asked = useRef(0);
  // The agent's standing the last read on its own was asked for.
  const readFor = useRef<boolean | undefined>(undefined);

  const ask = useCallback(() => {
    asked.current += 1;
    const ask = asked.current;
    setOut(true);
    const settle = (next: CodingAgentChangesAnswerView) => {
      if (ask !== asked.current) return;
      setOut(false);
      setAnswer(next);
    };
    latest.current(agentId).then(settle, () => settle(UNANSWERED));
  }, [agentId]);

  useEffect(() => {
    if (!shown || readFor.current === ended) return;
    readFor.current = ended;
    ask();
  }, [shown, ended, ask]);

  return { answer, out, ask };
}

/** The tree of changed files: the bundle's tree narrowed to them, the shown file marked; a choice there shows another. */
function ChangedFilesTree({
  paths,
  chosen,
  onChoose,
}: {
  paths: readonly string[];
  chosen: string;
  onChoose: (path: string) => void;
}): React.JSX.Element {
  const loaded = useAtomValue(fileTreeModuleAtom);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<FileTreeHandle | undefined>(undefined);
  // Note that the tree is handed a door that reads the latest choice, so it
  // is mounted once however often the tab is drawn.
  const latest = useRef(onChoose);
  latest.current = onChoose;

  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    const mounted = module.mount(element, {
      readFolder: () => NO_FOLDER,
      onOpen: (path) => latest.current(path),
    });
    handle.current = mounted;
    return () => {
      handle.current = undefined;
      mounted.unmount();
    };
  }, [module]);
  useEffect(() => {
    handle.current?.only(paths);
  }, [module, paths]);
  useEffect(() => {
    handle.current?.reveal(chosen, { focus: false });
  }, [module, chosen]);

  return (
    <aside className="file-tree-pane ph-no-capture" aria-label="Changed files">
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

/** The chosen file: its path, where it moved from, what became of it, its lines added and removed, and its diff or why there is none. */
function FileDiff({ file }: { file: CodingAgentChangedFile }): React.JSX.Element {
  const notice = fileNotice(file);
  // A file with no notice has a patch with hunks, which may yet not read as a diff.
  const hunks = useMemo(
    () => (notice === undefined && file.patch !== null ? patchHunks(file.patch) : undefined),
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
        <LinesChanged additions={file.additions} deletions={file.deletions} />
      </header>
      {hunks === undefined ? (
        <p className="changes-notice">{notice ?? CHANGES_WORDS.UNREADABLE}</p>
      ) : (
        <div className="file-tab-lines diff-lines">
          {hunks.map((hunk, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a file's hunks are drawn once per patch, in order.
            <Fragment key={index}>
              <div className="diff-hunk-header">
                <span className="diff-line-number" />
                <span className="diff-line-number" />
                <span className="diff-line-text">{hunk.header}</span>
              </div>
              {hunk.rows.map((row, at) => (
                // oxlint-disable-next-line react/no-array-index-key -- a hunk's rows never move within it.
                <div key={at} className="diff-line" data-kind={row.kind}>
                  <span className="diff-line-number">{row.oldLine}</span>
                  <span className="diff-line-number">{row.newLine}</span>
                  <span className="diff-line-text">
                    {row.kind === DIFF_ROW.NOTE
                      ? row.text.trim()
                      : row.text === ""
                        ? BLANK_LINE_TEXT
                        : row.text}
                  </span>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}

/** The Changes tab's name: its agent's own, after the word for what it shows. */
export function changesTabLabel(agentId: string, control: CodingAgentsControl): string {
  const agent = control.agents?.find((each) => each.id === agentId);
  return agent === undefined ? "Changes" : `Changes: ${agentTabLabel(agent, control.models)}`;
}

export function AgentChangesTab({
  agentId,
  control,
  shown,
}: {
  agentId: string;
  control: CodingAgentsControl;
  /** Whether the panel is on screen, which is when the tab reads. */
  shown: boolean;
}): React.JSX.Element {
  const { tell } = useAct();
  const status = control.agents?.find((each) => each.id === agentId)?.status;
  const ended = !agentStillWriting(status ?? CODING_AGENT_STATUS.RUNNING);
  const { answer, out, ask } = useChangesRead(agentId, shown, ended, control.readChanges);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const pullRequest = answer !== undefined && "pullRequest" in answer ? answer.pullRequest : null;
  // Note that the list is kept while the answer is the same one, because a
  // fresh list would have the tree draw itself anew.
  const paths = useMemo(() => pullRequest?.files.map((file) => file.path) ?? [], [pullRequest]);
  const shownFile =
    pullRequest?.files.find((file) => file.path === chosen) ?? pullRequest?.files[0];
  // A failure gives way to the wait as soon as it is asked again; files drawn stand until the answer lands.
  if (answer === undefined || (out && "failure" in answer)) {
    return (
      <div className="changes-view">
        <SpinnerRegion label={CHANGES_WORDS.READING} />
      </div>
    );
  }
  if ("failure" in answer) {
    return (
      <div className="changes-view changes-failed">
        <p className="m-0" role="alert">
          {CHANGES_WORDS.FAILED}
        </p>
        <RetryButton onRetry={ask} />
      </div>
    );
  }
  if (pullRequest === null || shownFile === undefined) {
    return (
      <div className="changes-view">
        <EmptyState icon={<FileDiffIcon />}>
          {pullRequest === null ? CHANGES_WORDS.NO_PULL_REQUEST : CHANGES_WORDS.EMPTY}
        </EmptyState>
      </div>
    );
  }
  const { files } = pullRequest;
  const count = files.length;
  return (
    <div className="changes-view file-view ph-no-capture">
      <header className="file-view-bar">
        <span className="changes-count">
          {count} {count === 1 ? "file" : "files"}
        </span>
        <LinesChanged
          additions={files.reduce((sum, file) => sum + file.additions, 0)}
          deletions={files.reduce((sum, file) => sum + file.deletions, 0)}
        />
        <div className="file-view-actions">
          <Tooltip label="Open on GitHub">
            <button
              type="button"
              className="icon-button"
              aria-label="Open on GitHub"
              onClick={() => tell(ACT_KIND.GITHUB_OPEN, { url: `${pullRequest.url}/files` })}
            >
              <GitHubMark />
            </button>
          </Tooltip>
          <Tooltip label="Refresh">
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh changes"
              aria-busy={out}
              disabled={out}
              onClick={ask}
            >
              <RotateCwIcon aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </header>
      {pullRequest.truncated ? (
        <p className="changes-truncated">{CHANGES_WORDS.TRUNCATED}</p>
      ) : null}
      <div className="file-view-body">
        <FileDiff file={shownFile} />
        <ChangedFilesTree paths={paths} chosen={shownFile.path} onChoose={setChosen} />
      </div>
    </div>
  );
}
