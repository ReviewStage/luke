import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
} from "@sidecar/hosted/coding-agent-wire";
import { CopyIcon } from "@sidecar/panel";
import { FileDiffIcon, GitBranchIcon, TerminalIcon } from "lucide-react";
import type { ReactNode } from "react";
import { GitHubMark } from "../account-marks";
import {
  ActionMenu,
  MENU_ALIGN,
  MENU_DROP,
  type MenuAction,
  type MenuPlacement,
  useActionMenu,
} from "../desktop/action-menu";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import {
  checkoutCommand,
  publishedUrl,
  pullRequestNumberLabel,
  pullRequestPillLabel,
  pullRequestStateWord,
} from "./coding-agent-model";

/**
 * agent-published.tsx -- what an agent published, on its tab: the pull request or branch chip at the box's foot, and the pull request's row at a finished transcript's end.
 *
 * The box's foot wears one of two chips once the agent has pushed, after
 * the model chip and in its style: one for its pull request, the GitHub
 * mark and the number coloured by where the pull request stands; or, with
 * a branch and no pull request yet, one naming the branch. A press of
 * either opens it on GitHub, the pull request or the branch compared, and
 * a right-click offers what a press does not: copying the branch's name or
 * the command that checks it out. The row says the number and title, that
 * the checks failed where they did, the lines added and removed, and where
 * the pull request stands only where that changes what the developer would
 * do; a press of it opens the pull request. Nothing here is drawn before
 * the service has said what stands, so a tab on an agent still reading the
 * repository wears nothing yet. Beside the pull request's chip stands a
 * Changes chip, which opens the pull request's files and their diffs in
 * the side panel (`agent-changes-tab.tsx`).
 */

/** The doors the chip and the row open: a page of GitHub's in the browser, and the clipboard, its toast reading `label`. */
export interface PublishedDoors {
  openGitHub: (url: string) => void;
  copy: (words: string, label: string) => void;
  /** Opens the agent's changes in a tab of the side panel's own; none where the view stands in no panel. */
  openChanges?: (() => void) | undefined;
}

const MENU_LABEL = "Branch actions";
const OPEN_HINT = "Open on GitHub";
const CHECKS_FAILING = "Checks failing";

/** Where the right-click menu hangs: at the pointer, or under the chip where the keyboard asked and said no point of its own. */
function menuPlacement(event: React.MouseEvent<HTMLElement>): MenuPlacement {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return { x: event.clientX, y: event.clientY, align: MENU_ALIGN.START };
  }
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.START };
}

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

/** The chip's face: the pull request's mark and number, or the branch's icon and name. */
function PublishedFace({ published }: { published: CodingAgentPullRequestAnswer }): ReactNode {
  if (published.pullRequest !== null) {
    return (
      <>
        <GitHubMark />
        <span className="agent-pr-number">{pullRequestNumberLabel(published.pullRequest)}</span>
      </>
    );
  }
  return (
    <>
      <GitBranchIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="plan-compose-chip-name agent-branch-name">{published.branch}</span>
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
  const url = published === undefined ? undefined : publishedUrl(published);
  if (published === undefined || url === undefined) return null;
  const { pullRequest, branch } = published;
  const label = pullRequest !== null ? pullRequestPillLabel(pullRequest) : (branch ?? "");
  return (
    <>
      <Tooltip label={OPEN_HINT}>
        <button
          type="button"
          className="plan-compose-chip agent-published-chip"
          data-state={pullRequest?.state}
          data-menu-open={String(menu.open !== undefined)}
          aria-label={label}
          onClick={() => {
            menu.close(false);
            doors.openGitHub(url);
          }}
          onContextMenu={
            branch === null
              ? undefined
              : (event) => {
                  event.preventDefault();
                  menu.show(menuPlacement(event), event.currentTarget);
                }
          }
        >
          <PublishedFace published={published} />
        </button>
      </Tooltip>
      {menu.drawn === undefined || branch === null ? null : (
        <ActionMenu
          menu={menu.drawn}
          groups={branchActions(branch, doors)}
          label={MENU_LABEL}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The chip that opens the pull request's changes in the side panel, worn beside its own chip; nothing before a pull request stands or where no panel takes the tab.
 *
 * A pull request stands once the agent's turn ends on a pushed branch other than the default with a pull request open from it (`coder-host/published.ts`); a local branch or an uncommitted edit alone shows no chip.
 */
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
      <button
        type="button"
        className="plan-compose-chip agent-changes-chip"
        aria-label="Show changes"
        onClick={openChanges}
      >
        <FileDiffIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="plan-compose-chip-name">Changes</span>
      </button>
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

/** The row at the end of a finished transcript: the pull request's number and title, that its checks failed where they did, the lines it adds and removes, and where it stands if that matters; a press opens it. */
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
        data-state={pullRequest.state}
        onClick={() => openGitHub(pullRequest.url)}
      >
        <GitHubMark />
        <span ref={words} className="agent-published-title" data-overflow={String(clipped)}>
          {pullRequestNumberLabel(pullRequest)} · {pullRequest.title}
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
