import type {
  CodingAgentPullRequest,
  CodingAgentPullRequestAnswer,
} from "@sidecar/hosted/coding-agent-wire";
import { CopyIcon, ExternalIcon } from "@sidecar/panel";
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
 * agent-published.tsx -- what an agent published, on its tab: the pull request or branch chip at the box's foot with its menu, and the row that sums a finished turn up.
 *
 * The box's foot wears one of two chips once the agent has pushed, after
 * the model chip and in its style: one for its pull request, the GitHub
 * mark and the number coloured by where the pull request stands with a
 * dot for its checks; or, with a branch and no pull request yet, one
 * naming the branch. A press of either drops a small menu: opening the
 * pull request, copying the branch's name or the command that checks it
 * out, and reading the changes on GitHub, each where it has something to
 * act on. Nothing here is drawn before the service has said what stands,
 * so a tab on an agent still reading the repository wears nothing yet.
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

/** What the menu offers for what stands: each action only where it has something to act on. */
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

/** The chip's face: the pull request's mark, number, and check dot, or the branch's icon and name. */
function PublishedFace({ published }: { published: CodingAgentPullRequestAnswer }): ReactNode {
  if (published.pullRequest !== null) {
    return (
      <>
        <GitHubMark />
        <span className="agent-pr-number">{pullRequestNumberLabel(published.pullRequest)}</span>
        <CheckDot checks={published.pullRequest.checks} />
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

/** What the box's foot wears for what stands: the pull request's chip, else the branch's, else nothing; a press drops the menu. */
export function PublishedChip({
  published,
  doors,
}: {
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
}): ReactNode {
  const [open, setOpen] = useState<OpenMenu | undefined>(undefined);
  const opener = useRef<HTMLButtonElement | null>(null);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(undefined);
    if (returnFocus) opener.current?.focus();
  }, []);
  if (published === undefined || (published.pullRequest === null && published.branch === null)) {
    return null;
  }
  const { pullRequest, branch } = published;
  const label = pullRequest !== null ? pullRequestPillLabel(pullRequest) : (branch ?? "");
  const hint = pullRequest !== null ? pullRequest.title : (branch ?? "");
  return (
    <>
      <Tooltip label={hint}>
        <button
          ref={opener}
          type="button"
          className="plan-compose-chip agent-published-chip"
          data-state={pullRequest?.state}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open !== undefined}
          onClick={(event) => {
            if (open !== undefined) {
              close(true);
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            setOpen({
              placement: { x: bounds.left, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.START },
              opener: event.currentTarget,
            });
          }}
        >
          <PublishedFace published={published} />
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
        className="toolbar-button agent-published-open"
        onClick={() => openGitHub(pullRequest.url)}
      >
        Open
      </button>
    </div>
  );
}
