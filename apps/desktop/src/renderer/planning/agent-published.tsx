import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
} from "@luke/features/coding-agent-wire";
import type { PrRunTarget } from "@luke/features/pr-run-view";
import { CopyIcon } from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import {
  FileDiffIcon,
  FolderOpenIcon,
  GitBranchIcon,
  PlayIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { CHIP_LOOK, Chip } from "../chip";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "../settings/confirm-dialog";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import {
  checkoutCommand,
  publishedUrl,
  pullRequestNumberLabel,
  pullRequestStateWord,
} from "./coding-agent-model";
import { PullRequestMark, pullRequestMarkLabel } from "./pull-request-mark";

/**
 * agent-published.tsx -- what an agent published, on its tab: the pull request or branch chip at the box's foot, and the pull request's row at a finished transcript's end.
 *
 * The box's foot wears one of two chips once the agent has pushed, after
 * the + and in the composer's pill (`../chip.tsx`), since each names a
 * thing the agent made rather than a setting the quiet model chip at the
 * foot's other end picks: one for its pull request, its mark
 * (`pull-request-mark.tsx`) and its number in the mark's colour; or, with
 * a branch and no pull request yet, one naming the branch. A press of
 * either opens it on GitHub, the pull request or the branch compared, and
 * a right-click offers what a press does not: copying the branch's name or
 * the command that checks it out, and, for a pull request on a panel that
 * can draw its run, running it on this Mac in Luke's own checkout of it,
 * showing that checkout in Finder, and deleting it, which asks first
 * (`pr-run-tab.tsx`). The row wears the same mark and says the
 * number and title, that the checks failed where they did, the lines added
 * and removed, and where the pull request stands only where that changes what the developer would
 * do; a press of it opens the pull request. Nothing here is drawn before
 * the service has said what stands, so a tab on an agent still reading the
 * repository wears nothing yet. Beside the pull request's chip stands a
 * Changes chip, which opens the pull request's files and their diffs in
 * the side panel (`agent-changes-tab.tsx`). A composer too narrow for
 * their words draws each chip's mark alone, its hint and label still
 * naming it (planning.css).
 */

/** The doors the chip and the row open: a page of GitHub's in the browser, and the clipboard, its toast reading `label`. */
export interface PublishedDoors {
  openGitHub: (url: string) => void;
  copy: (words: string, label: string) => void;
  /** Opens the agent's changes in a tab of the side panel's own; none where the view stands in no panel. */
  openChanges?: (() => void) | undefined;
  /** Running the pull request on this Mac; none where the view stands in no panel that can draw the run. */
  runOnMac?: RunOnMacDoors | undefined;
}

/** What the pull request's menu does on this Mac, each for the pull request it is handed. */
export interface RunOnMacDoors {
  /** The workspace the pull request's repository is reached through. */
  readonly workspaceId: string;
  /** Opens the pull request's run tab and runs it. */
  readonly run: (pullRequest: PrRunTarget) => void;
  readonly showInFinder: (pullRequest: PrRunTarget) => void;
  /** Deletes Luke's checkout of it, rejecting with why where it could not. */
  readonly deleteCheckout: (pullRequest: PrRunTarget) => Promise<void>;
}

/** What Delete Local Checkout asks first. */
const DELETE_CHECKOUT_QUESTION: DialogQuestion = {
  title: "Delete local checkout?",
  body: "Luke's checkout of this pull request on this Mac, and everything its runs installed there, will be deleted. The pull request on GitHub is not touched.",
  verb: "Delete",
  running: "Deleting",
};

const MENU_LABEL = "Branch actions";
const CHECKS_FAILING = "Checks failing";

/** What the chip's right-click offers for a branch: its name and the command that checks it out, each to the clipboard. */
function branchActions(branch: string, doors: PublishedDoors): MenuAction[][] {
  return [
    [
      {
        label: "Copy branch name",
        icon: <CopyIcon />,
        onSelect: () => doors.copy(branch, "Branch name copied"),
      },
      {
        label: "Copy checkout command",
        icon: <TerminalIcon />,
        onSelect: () => doors.copy(checkoutCommand(branch), "Checkout command copied"),
      },
    ],
  ];
}

/** What the menu offers for a pull request on this Mac: run it, show its checkout, and delete it. */
function runOnMacActions(
  askDelete: () => void,
  pullRequest: PrRunTarget,
  doors: RunOnMacDoors,
): MenuAction[] {
  return [
    { label: "Run on this Mac", icon: <PlayIcon />, onSelect: () => doors.run(pullRequest) },
    {
      label: "Show in Finder",
      icon: <FolderOpenIcon />,
      onSelect: () => doors.showInFinder(pullRequest),
    },
    { label: "Delete Local Checkout", icon: <Trash2Icon />, danger: true, onSelect: askDelete },
  ];
}

/** The chip's face: the pull request's mark and number, or the branch's icon and name. */
function PublishedFace({ published }: { published: CodingAgentPullRequestAnswer }): ReactNode {
  if (published.pullRequest !== null) {
    return (
      <>
        <PullRequestMark pullRequest={published.pullRequest} />
        <span className="chip-name agent-pr-number">
          {pullRequestNumberLabel(published.pullRequest)}
        </span>
      </>
    );
  }
  return (
    <>
      <GitBranchIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="chip-name agent-branch-name">{published.branch}</span>
    </>
  );
}

/** What the box's foot wears for what stands: the pull request's chip, else the branch's, else nothing; a press opens it on GitHub, a right-click offers the branch's copies. */
export function PublishedChip({
  published,
  doors,
}: {
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
}): ReactNode {
  const menu = useActionMenu(true);
  const { runOnMac } = doors;
  const onMac: PrRunTarget | undefined =
    runOnMac === undefined || published?.pullRequest == null
      ? undefined
      : {
          workspaceId: runOnMac.workspaceId,
          repository: published.repository,
          number: published.pullRequest.number,
        };
  const deletion = useConfirmDialog(
    { subject: onMac !== undefined, surfaceOpen: true },
    (): Promise<ActionResult> =>
      onMac === undefined || runOnMac === undefined
        ? Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED })
        : runOnMac.deleteCheckout(onMac).then(
            (): ActionResult => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
            (refused: Error): ActionResult => ({
              status: ACTION_RESULT_STATUS.REJECTED,
              reason: refused.message,
            }),
          ),
  );
  const url = published === undefined ? undefined : publishedUrl(published);
  if (published === undefined || url === undefined) return null;
  const { pullRequest, branch } = published;
  const label = pullRequest !== null ? pullRequestMarkLabel(pullRequest) : (branch ?? "");
  const groups =
    branch === null
      ? []
      : [
          ...branchActions(branch, doors),
          ...(onMac === undefined || runOnMac === undefined
            ? []
            : [runOnMacActions(deletion.ask, onMac, runOnMac)]),
        ];
  // Named in the hint too, since a narrow composer draws the chip's mark alone.
  const opens = pullRequest !== null ? pullRequestNumberLabel(pullRequest) : (branch ?? "");
  return (
    <>
      <Tooltip label={`Open ${opens} on GitHub`}>
        <Chip
          look={CHIP_LOOK.PILL}
          className="agent-published-chip"
          data-pull-request-state={pullRequest?.state}
          data-menu-open={String(menu.open !== undefined)}
          aria-label={label}
          onClick={() => {
            menu.close(false);
            doors.openGitHub(url);
          }}
          onContextMenu={groups.length === 0 ? undefined : menu.contextMenu()}
        >
          <PublishedFace published={published} />
        </Chip>
      </Tooltip>
      {menu.drawn === undefined || groups.length === 0 ? null : (
        <ActionMenu menu={menu.drawn} groups={groups} label={MENU_LABEL} onClose={menu.close} />
      )}
      <ConfirmDialog confirm={deletion} question={DELETE_CHECKOUT_QUESTION} />
    </>
  );
}

/** The chip that opens the pull request's changes in the side panel, worn beside its own chip; nothing before a pull request stands or where no panel takes the tab. */
export function ChangesChip({
  published,
  doors,
}: {
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
}): ReactNode {
  const { openChanges } = doors;
  if (published === undefined || published.pullRequest === null || openChanges === undefined) {
    return null;
  }
  return (
    <Tooltip label="Show changes">
      <Chip
        look={CHIP_LOOK.PILL}
        className="agent-changes-chip"
        aria-label="Show changes"
        onClick={openChanges}
      >
        <FileDiffIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="chip-name">Changes</span>
      </Chip>
    </Tooltip>
  );
}

/** The lines a change adds and removes, as GitHub counts them: green, then red. */
export function LinesChanged({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): React.JSX.Element {
  return (
    <span className="agent-published-lines">
      <span className="agent-published-added">+{additions}</span>{" "}
      <span className="agent-published-removed">−{deletions}</span>
    </span>
  );
}

/** The row at the end of a finished transcript: the pull request's number and title, that its checks failed where they did, the lines it adds and removes, and where it stands if that matters; a press opens it. A narrow row gives up the checks' word, then the lines, before the number (planning.css). */
export function PublishedRow({
  pullRequest,
  openGitHub,
}: {
  pullRequest: CodingAgentPullRequest;
  openGitHub: (url: string) => void;
}): ReactNode {
  // Whether the title is cut short, which fades it and lets the pointer read it whole.
  const [words, clipped] = useClipped();
  const state = pullRequestStateWord(pullRequest.state);
  return (
    <Tooltip label={clipped ? pullRequest.title : undefined}>
      <button
        type="button"
        className="agent-published-row"
        data-published-row=""
        onClick={() => openGitHub(pullRequest.url)}
      >
        <PullRequestMark pullRequest={pullRequest} />
        <span className="agent-published-name">
          <span className="agent-published-number">{pullRequestNumberLabel(pullRequest)} ·</span>
          <span ref={words} className="agent-published-title" data-overflow={String(clipped)}>
            {pullRequest.title}
          </span>
        </span>
        {pullRequest.checks === CHECK_SUMMARY.FAILING ? (
          <span className="agent-published-checks">{CHECKS_FAILING}</span>
        ) : null}
        {state === undefined ? null : <span className="agent-published-state">{state}</span>}
        <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
      </button>
    </Tooltip>
  );
}
