import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChangesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentChangedFile,
  type CodingAgentChangesPeople,
  type CodingAgentPullRequest,
} from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { ACT_KIND } from "@luke/host/acts";
import { CopyIcon, DownloadIcon } from "@luke/ui";
import { fileName } from "@luke/voice/code-pane-model";
import { ClipboardCopyIcon, FileDiffIcon, RotateCwIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act";
import { useCopyToast } from "../copy-feedback";
import { EmptyState } from "../empty-state";
import { CardHead, CardNote, HoverCard } from "../hover-card";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { SpinnerRegion } from "../spinner";
import { Tooltip } from "../tooltip";
import { LinesChanged } from "./agent-published";
import { AgentActorRef, type AgentSubject, agentSubject, NOTHING_HELD } from "./agent-ref";
import {
  CHANGES_WORDS,
  changedFolders,
  changeMarks,
  DIFF_ROW,
  fileNotice,
  filePatch,
  linesChanged,
  patchHunks,
  STATUS_LETTER,
  STATUS_WORDS,
} from "./changes-model";
import { BLANK_LINE_TEXT, CodeLineNumber } from "./code-pane";
import { agentStillWriting, pullRequestNumberLabel } from "./coding-agent-model";
import { LinesMenu, useSaveText } from "./file-menu";
import { useLinesLook } from "./file-tab";
import { FileTreePane } from "./file-tree-pane";
import { FileViewBar, usePaneRoom } from "./file-view";
import { PullRequestMark } from "./pull-request-mark";
import { OpenedBy, PullRequestPeople, ReviewersLine } from "./pull-request-people";
import type { CodingAgentsControl, HeldPeople } from "./use-coding-agents";

/**
 * agent-changes-tab.tsx -- the Files changed view of an agent's Pull request tab (`agent-pull-request-tab.tsx`): its pull request's files drawn as a File tab draws a file, the chosen file's unified diff under the same bar and beside the same tree.
 *
 * The files are read from GitHub afresh by the service on each ask, so
 * nothing here reads on a clock: the tab asks as it first comes on screen,
 * when the developer presses Retry or Refresh changes, and the moment the
 * agent ends, since that is when what it published has settled. A refresh
 * leaves the files drawn standing until its answer lands; a read that
 * failed says so with a retry, as a File tab's does; an agent with no pull
 * request yet, or one whose pull request changes nothing, says that. The
 * panel keys the tab by its agent, so one agent's answer is never drawn in
 * another's tab.
 *
 * Under its bar the view says who the pull request names, who opened it,
 * its reviewers, and who authored its commits (`pull-request-people.tsx`);
 * what the reviews said stands in the tab's overview, whole, in its
 * conversation.
 *
 * Otherwise the tab is a File view (`file-view.tsx`) over the diff: its bar
 * names the chosen file as breadcrumbs, whose trees list only the changed
 * files, with the letter of what became of it and the lines it adds and
 * removes quietly beside, then the pull request's files on GitHub, the ⋯
 * (the file's name or its patch copied, the patch saved, the changes read
 * again, and the File tabs' two settings), and the tree's toggle, which
 * shows and hides the tree for every File and Changes tab alike. The tree
 * is a File tab's own pane (`file-tree-pane.tsx`) narrowed to the changed
 * files, every folder open, each row lettered A, M, D, or R, searched in
 * place, with the pull request's count under it, or under the diff while
 * the tree is hidden; choosing a file there or
 * in a crumb's tree shows its diff. The diff is drawn in a File tab's lines
 * (`code-pane.tsx`), numbered on both sides in the same gutter, numbered
 * and wrapped as the File tabs' settings say, left out of the find and of
 * a copy as a File tab's numbers are; what is a diff's alone is the tint of
 * a line added or removed, the hunk's header, and git's note on a line.
 * Every name and line here is the repository's, so the tab is left out of
 * the screen recording (`ph-no-capture`).
 */

/** What the row holding a hunk's header is, beside the kinds of row the hunk holds. */
const DIFF_HUNK = "hunk";

type DiffLineKind = (typeof DIFF_ROW)[keyof typeof DIFF_ROW] | typeof DIFF_HUNK;

/** A read that threw rather than answered, drawn as any other failed read. */
const UNANSWERED: CodingAgentChangesAnswerView = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };

/**
 * One agent's read as last answered, none before the first read lands;
 * whether a read is out; and the door that reads it again. The read is
 * asked as the tab first comes on screen and again the moment the agent
 * ends, since that is when what it published settles; every ask is
 * numbered, so only the latest one's answer is drawn, and a read that threw
 * rather than answered lands as `unanswered`. The Changes and Pull request
 * tabs read through it alike.
 */
export function useAgentRead<A>(
  agentId: string,
  shown: boolean,
  ended: boolean,
  read: (agentId: string) => Promise<A>,
  unanswered: A,
) {
  const [answer, setAnswer] = useState<A | undefined>(undefined);
  const [out, setOut] = useState(false);
  const latest = useRef({ read, unanswered });
  latest.current = { read, unanswered };
  const asked = useRef(0);
  // The agent's standing the last read on its own was asked for.
  const readFor = useRef<boolean | undefined>(undefined);

  const ask = useCallback(() => {
    asked.current += 1;
    const ask = asked.current;
    setOut(true);
    const settle = (next: A) => {
      if (ask !== asked.current) return;
      setOut(false);
      setAnswer(next);
    };
    latest.current.read(agentId).then(settle, () => settle(latest.current.unanswered));
  }, [agentId]);

  useEffect(() => {
    if (!shown || readFor.current === ended) return;
    readFor.current = ended;
    ask();
  }, [shown, ended, ask]);

  return { answer, out, ask };
}

/** What became of the chosen file, quiet beside its path in the bar: its letter, named in its hint, and the lines it adds and removes. */
function ChangeBeside({ file }: { file: CodingAgentChangedFile }): React.JSX.Element {
  return (
    <>
      <Tooltip label={STATUS_WORDS[file.status]}>
        <span className="file-view-status" data-status={file.status}>
          {STATUS_LETTER[file.status]}
        </span>
      </Tooltip>
      <LinesChanged additions={file.additions} deletions={file.deletions} />
    </>
  );
}

/** The bar's ⋯ over a diff: the file's name or its patch copied, the patch saved, and the changes read again, over the File tabs' settings. */
function ChangesMenu({
  file,
  reading,
  onRefresh,
}: {
  file: CodingAgentChangedFile;
  /** Whether a read is out, which a refresh would only repeat. */
  reading: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  const copyWithToast = useCopyToast();
  const saveText = useSaveText();
  const name = fileName(file.path);
  const patch = filePatch(file);
  return (
    <LinesMenu
      label="Changes actions"
      actions={[
        {
          label: "Copy file name",
          icon: <CopyIcon />,
          onSelect: () => copyWithToast(name, "File name copied"),
        },
        {
          label: "Copy patch",
          icon: <ClipboardCopyIcon aria-hidden="true" />,
          disabled: patch === undefined,
          onSelect: () => {
            if (patch !== undefined) copyWithToast(patch, "Patch copied");
          },
        },
        {
          label: "Download patch",
          icon: <DownloadIcon />,
          disabled: patch === undefined,
          onSelect: () => {
            if (patch !== undefined) saveText(`${name}.patch`, patch).catch(() => undefined);
          },
        },
        {
          label: "Refresh changes",
          icon: <RotateCwIcon aria-hidden="true" />,
          disabled: reading,
          onSelect: onRefresh,
        },
      ]}
    />
  );
}

/** One row of the diff in a File tab's line: the old side's number, the new side's, and its text, tinted by what it is. */
function DiffLine({
  kind,
  oldLine,
  newLine,
  children,
}: {
  kind: DiffLineKind;
  oldLine: number | undefined;
  newLine: number | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="code-line" data-diff={kind}>
      <CodeLineNumber line={oldLine} />
      <CodeLineNumber line={newLine} />
      <code className="code-line-text">{children}</code>
    </div>
  );
}

/** The chosen file: where it moved from, and its diff, or why there is none, in a File tab's place. */
function FileDiff({ file }: { file: CodingAgentChangedFile }): React.JSX.Element {
  const look = useLinesLook();
  const notice = fileNotice(file);
  // A file with no notice has a patch with hunks, which may yet not read as a diff.
  const hunks = useMemo(
    () => (notice === undefined && file.patch !== null ? patchHunks(file.patch) : undefined),
    [file.patch, notice],
  );
  return (
    <section className="file-tab" aria-label={`Diff of ${file.path}`}>
      {file.previousPath === null ? null : (
        <div className="file-tab-notice">
          <p className="m-0">
            Renamed from <bdi>{file.previousPath}</bdi>
          </p>
        </div>
      )}
      {hunks === undefined ? (
        <p className="side-panel-empty">{notice ?? CHANGES_WORDS.UNREADABLE}</p>
      ) : (
        <div className="code-lines file-tab-lines scroll-fade-top" {...look}>
          {hunks.map((hunk, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a file's hunks are drawn once per patch, in order.
            <Fragment key={index}>
              <DiffLine kind={DIFF_HUNK} oldLine={undefined} newLine={undefined}>
                {hunk.header}
              </DiffLine>
              {hunk.rows.map((row, at) => (
                // oxlint-disable-next-line react/no-array-index-key -- a hunk's rows never move within it.
                <DiffLine key={at} kind={row.kind} oldLine={row.oldLine} newLine={row.newLine}>
                  {row.kind === DIFF_ROW.NOTE
                    ? row.text.trim()
                    : row.text === ""
                      ? BLANK_LINE_TEXT
                      : row.text}
                </DiffLine>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}

/** Who a pull request names, as its tab last read them for that very pull request; none where the tab read them for another, or has not yet. */
export function peopleOf(
  held: HeldPeople | undefined,
  pullRequest: Pick<CodingAgentPullRequest, "url">,
): CodingAgentChangesPeople | undefined {
  return held?.url === pullRequest.url ? held.people : undefined;
}

/**
 * The card a Changes tab hangs, and its row in the plan's summary, in a tab
 * card's look: the pull request's title with its mark and number at the
 * right, the coding agent whose pull request it is under the title, by its
 * tile and name as every place naming an agent draws it (`ActorRef`),
 * which hang the agent's card and open its tab, and under them how many
 * files it changes and the lines it adds and removes, as GitHub counts
 * them, then, once its Changes tab has read them, who opened it and its
 * reviewers, each face wearing where they stand (`pull-request-people.tsx`).
 */
export function ChangesCard({
  subject,
  models,
  pullRequest,
  people,
  onOpenAgent,
}: {
  /** The agent whose pull request it is, as the plan's list names it. */
  subject: AgentSubject;
  /** The catalog as last read, which names the agent's model on its card. */
  models: readonly CatalogModel[] | undefined;
  pullRequest: CodingAgentPullRequest;
  /** Who the pull request names, as its Changes tab last read them; none before it has. */
  people: CodingAgentChangesPeople | undefined;
  /** Opens the agent's tab in the plan's column. */
  onOpenAgent: () => void;
}): React.JSX.Element {
  const count = pullRequest.changedFiles;
  const agent = { subject, models };
  const reviewers = people?.reviewers ?? [];
  return (
    <HoverCard data-tab-card="">
      <CardHead
        name={pullRequest.title}
        sub={<AgentActorRef subject={subject} models={models} onOpen={onOpenAgent} />}
        corner={
          <>
            <PullRequestMark pullRequest={pullRequest} />
            {pullRequestNumberLabel(pullRequest)}
          </>
        }
      />
      <CardNote>
        {count} {count === 1 ? "file" : "files"} changed{" "}
        <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
      </CardNote>
      {people?.author === undefined ? null : (
        <CardNote oneLine>
          <OpenedBy person={people.author} writtenAs={people.writtenAs} agent={agent} />
        </CardNote>
      )}
      {reviewers.length === 0 ? null : (
        <CardNote>
          <ReviewersLine reviewers={reviewers} agent={agent} />
        </CardNote>
      )}
    </HoverCard>
  );
}

export function AgentChangesTab({
  agentId,
  control,
  shown,
  repository,
  tree,
}: {
  agentId: string;
  control: CodingAgentsControl;
  /** Whether the panel is on screen, which is when the tab reads. */
  shown: boolean;
  /** The plan's repository, which the agent works in and the breadcrumbs name; none names the path plain. */
  repository: string | null;
  /** Whether the tree beside File and Changes tabs is open, and its toggle. */
  tree: { readonly open: boolean; readonly onToggle: () => void };
}): React.JSX.Element {
  const { tell } = useAct();
  const status = control.agents?.find((each) => each.id === agentId)?.status;
  const ended = !agentStillWriting(status ?? CODING_AGENT_STATUS.RUNNING);
  const { answer, out, ask } = useAgentRead(agentId, shown, ended, control.readChanges, UNANSWERED);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const room = usePaneRoom(tree);
  const pullRequest = answer !== undefined && "pullRequest" in answer ? answer.pullRequest : null;
  // Note that the lists are kept while the answer is the same one, because
  // fresh ones would have the tree draw itself anew.
  const changed = useMemo(() => {
    const files = pullRequest?.files ?? [];
    const paths = files.map((file) => file.path);
    return { paths, marks: changeMarks(files), folders: changedFolders(paths) };
  }, [pullRequest]);
  const { closeOver } = room;
  // A file chosen in the tree floating over the diff takes the tree down, to show the file.
  const choose = useCallback(
    (path: string) => {
      closeOver();
      setChosen(path);
    },
    [closeOver],
  );
  const shownFile =
    pullRequest?.files.find((file) => file.path === chosen) ?? pullRequest?.files[0];
  // Luke's own bot is the agent whose pull request it is, wherever the pull request names it.
  const named = {
    subject: agentSubject(control, agentId, NOTHING_HELD, false),
    models: control.models,
  };
  // A failure gives way to the wait as soon as it is asked again; files drawn stand until the answer lands.
  if (answer === undefined || (out && "failure" in answer)) {
    return <SpinnerRegion label={CHANGES_WORDS.READING} />;
  }
  if ("failure" in answer) {
    return (
      <div className="side-panel-empty">
        <ReadFailure line={CHANGES_WORDS.FAILED} onRetry={ask} place={READ_FAILURE_PLACE.CENTRED} />
      </div>
    );
  }
  if (pullRequest === null) {
    return <EmptyState icon={<FileDiffIcon />}>{CHANGES_WORDS.NO_PULL_REQUEST}</EmptyState>;
  }
  // A pull request that changes no file still names its people, over the line saying so.
  if (shownFile === undefined) {
    return (
      <div className="file-view ph-no-capture">
        <PullRequestPeople people={pullRequest} agent={named} />
        <EmptyState icon={<FileDiffIcon />}>{CHANGES_WORDS.EMPTY}</EmptyState>
      </div>
    );
  }
  const count = pullRequest.files.length;
  const total = linesChanged(pullRequest.files);
  const counted = (
    <>
      {count} {count === 1 ? "file" : "files"} changed{" "}
      <LinesChanged additions={total.additions} deletions={total.deletions} />
    </>
  );
  return (
    <div className="file-view ph-no-capture" {...room.root}>
      <FileViewBar
        path={{
          path: shownFile.path,
          browse:
            repository === null
              ? undefined
              : { repository, listFolder: changed.folders, onOpen: choose },
        }}
        beside={<ChangeBeside file={shownFile} />}
        onGitHub={() => tell(ACT_KIND.GITHUB_OPEN, { url: `${pullRequest.url}/files` })}
        menu={<ChangesMenu file={shownFile} reading={out} onRefresh={ask} />}
        tree={room.toggles}
      />
      <PullRequestPeople people={pullRequest} agent={named} />
      {pullRequest.truncated ? (
        <div className="file-tab-notice">
          <p className="m-0">{CHANGES_WORDS.TRUNCATED}</p>
        </div>
      ) : null}
      <div className="file-view-body" {...room.body}>
        <FileDiff key={shownFile.path} file={shownFile} />
        {room.drawn ? (
          <FileTreePane
            file={shownFile.path}
            only={changed.paths}
            marks={changed.marks}
            label="Changed files"
            foot={counted}
            listFolder={changed.folders}
            onOpen={choose}
            pane={room.beside.pane}
            float={room.pane}
            leaving={room.beside.leaving}
          />
        ) : null}
      </div>
      {/* The count stands under the tree, and under the diff while the tree
          stands nowhere beside it, which the stylesheet says (tasks.css). */}
      <p className="file-tree-foot">{counted}</p>
    </div>
  );
}
