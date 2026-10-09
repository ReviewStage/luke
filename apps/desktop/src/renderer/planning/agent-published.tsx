import type {
  CodingAgentPullRequest,
  CodingAgentPullRequestAnswer,
} from "@sidecar/hosted/coding-agent-wire";
import { CopyIcon, EllipsisIcon, ExternalIcon } from "@sidecar/panel";
import { GitBranchIcon, TerminalIcon } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { GitHubMark } from "../account-marks";
import {
  ActionMenu,
  MENU_ALIGN,
  MENU_DROP,
  type MenuAction,
  type OpenMenu,
} from "../desktop/action-menu";
import { Tooltip } from "../tooltip";
import {
  CHECK_SUMMARY_LABEL,
  changesUrl,
  checkoutCommand,
  publishedSummary,
  pullRequestNumberLabel,
  pullRequestPillLabel,
} from "./coding-agent-model";

/**
 * agent-published.tsx -- what an agent published, on its tab: the pull request pill or the branch chip in the head, their ⋯ menu, and the row that sums a finished turn up.
 *
 * The head wears one of two things once the agent has pushed: a pill for
 * its pull request, the GitHub mark and the number coloured by where the
 * pull request stands with a dot for its checks, which opens the pull
 * request in the browser; or, with a branch and no pull request yet, a
 * chip naming the branch. Beside either, a ⋯ offers the rest: opening
 * the pull request, copying the branch's name or the command that checks
 * it out, and reading the changes on GitHub. Nothing here is drawn before
 * the service has said what stands, so a tab on an agent still reading
 * the repository wears nothing yet.
 */

/** The doors the menu and the row open: a page of GitHub's in the browser, and the clipboard. */
export interface PublishedDoors {
  openGitHub: (url: string) => void;
  copy: (words: string) => void;
}

const MENU_LABEL = "Pull request actions";

/** The one check dot, coloured by what the checks say and named for a reader who cannot see it. */
function CheckDot({ checks }: { checks: CodingAgentPullRequest["checks"] }): ReactNode {
  return (
    <span
      className="agent-check-dot"
      data-checks={checks}
      role="img"
      aria-label={CHECK_SUMMARY_LABEL[checks]}
    />
  );
}

/** The pull request's pill: the mark, the number in its state's colour, and the check dot; a press opens it. */
function PullRequestPill({
  pullRequest,
  openGitHub,
}: {
  pullRequest: CodingAgentPullRequest;
  openGitHub: (url: string) => void;
}): ReactNode {
  return (
    <Tooltip label={pullRequest.title}>
      <button
        type="button"
        className="agent-pr-pill"
        data-state={pullRequest.state}
        aria-label={pullRequestPillLabel(pullRequest)}
        onClick={() => openGitHub(pullRequest.url)}
      >
        <GitHubMark />
        <span className="agent-pr-number">{pullRequestNumberLabel(pullRequest)}</span>
        <CheckDot checks={pullRequest.checks} />
      </button>
    </Tooltip>
  );
}

/** The branch's chip, for a branch pushed with no pull request from it yet. */
function BranchChip({ branch }: { branch: string }): ReactNode {
  return (
    <span className="agent-branch-chip" title={branch}>
      <GitBranchIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="agent-branch-name">{branch}</span>
    </span>
  );
}

/** What the ⋯ offers for what stands: each action only where it has something to act on. */
function publishedActions(
  published: CodingAgentPullRequestAnswer,
  doors: PublishedDoors,
): MenuAction[][] {
  const { pullRequest, branch } = published;
  const changes = changesUrl(published);
  const groups: MenuAction[][] = [
    pullRequest === null
      ? []
      : [
          {
            label: "Open pull request",
            icon: <GitHubMark />,
            onSelect: () => doors.openGitHub(pullRequest.url),
          },
        ],
    branch === null
      ? []
      : [
          { label: "Copy branch name", icon: <CopyIcon />, onSelect: () => doors.copy(branch) },
          {
            label: "Copy checkout command",
            icon: <TerminalIcon />,
            onSelect: () => doors.copy(checkoutCommand(branch)),
          },
        ],
    changes === undefined
      ? []
      : [
          {
            label: "View changes on GitHub",
            icon: <ExternalIcon />,
            onSelect: () => doors.openGitHub(changes),
          },
        ],
  ];
  return groups.filter((group) => group.length > 0);
}

/** The ⋯ beside the pill or the chip, and the menu it drops. */
function PublishedMenuButton({
  published,
  doors,
}: {
  published: CodingAgentPullRequestAnswer;
  doors: PublishedDoors;
}): ReactNode {
  const [open, setOpen] = useState<OpenMenu | undefined>(undefined);
  const opener = useRef<HTMLButtonElement | null>(null);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(undefined);
    if (returnFocus) opener.current?.focus();
  }, []);
  return (
    <>
      <Tooltip label={MENU_LABEL}>
        <button
          ref={opener}
          type="button"
          className="toolbar-button toolbar-icon-button agent-published-more"
          aria-label={MENU_LABEL}
          aria-haspopup="menu"
          aria-expanded={open !== undefined}
          onClick={(event) => {
            if (open !== undefined) {
              close(true);
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            setOpen({
              placement: { x: bounds.right, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.END },
              opener: event.currentTarget,
            });
          }}
        >
          <EllipsisIcon />
        </button>
      </Tooltip>
      {open === undefined ? null : (
        <ActionMenu
          menu={open}
          groups={publishedActions(published, doors)}
          label={MENU_LABEL}
          onClose={close}
        />
      )}
    </>
  );
}

/** What the head wears for what stands: the pill, else the chip, else nothing; and the ⋯ beside either. */
export function PublishedHead({
  published,
  doors,
}: {
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
}): ReactNode {
  if (published === undefined || (published.pullRequest === null && published.branch === null)) {
    return null;
  }
  return (
    <>
      {published.pullRequest !== null ? (
        <PullRequestPill pullRequest={published.pullRequest} openGitHub={doors.openGitHub} />
      ) : published.branch !== null ? (
        <BranchChip branch={published.branch} />
      ) : null}
      <PublishedMenuButton published={published} doors={doors} />
    </>
  );
}

/** The row at the end of a finished transcript: what was opened and how much changed, with Open. */
export function PublishedRow({
  pullRequest,
  openGitHub,
}: {
  pullRequest: CodingAgentPullRequest;
  openGitHub: (url: string) => void;
}): ReactNode {
  return (
    <div
      className="agent-published-row flex h-9 items-center gap-2 rounded-lg border border-border bg-muted px-3 text-[12.5px]"
      data-published-row=""
      data-state={pullRequest.state}
    >
      <GitHubMark />
      <span className="min-w-0 flex-1 truncate">{publishedSummary(pullRequest)}</span>
      <CheckDot checks={pullRequest.checks} />
      <button
        type="button"
        className="plan-button agent-published-open"
        onClick={() => openGitHub(pullRequest.url)}
      >
        Open
      </button>
    </div>
  );
}
