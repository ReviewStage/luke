import {
  type AgentPullRequest,
  type AgentPullRequestAnswer,
  CHECK_SUMMARY,
} from "@luke/features/agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import {
  BUTTON_SIZE,
  CHIP_LOOK,
  Chip,
  ChipName,
  CountParts,
  LIST_VARIANT,
  List,
  ListRow,
  linesCount,
  MoreButton,
  RowHint,
  RowHintOptions,
  Tooltip,
  useMenu,
} from "@luke/ui";
import { GitBranchIcon, GLYPH } from "@luke/ui/icons";
import { pullRequestLabelOf } from "@luke/ui/tab-strip-model";
import type { ReactNode } from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { LINK_COPY } from "../copy-feedback.js";
import { ActionMenu, type MenuAction, rowMenu } from "../desktop/action-menu.js";
import { checkoutCommand, publishedUrl, pullRequestStateWord } from "./agent-model.js";
import { MentionChipCard } from "./mention-chip.js";
import { holderTaskId } from "./mention-holder.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { useMentionDoors } from "./task-mentions.js";
import { useLinkStanding } from "./use-link-standing.js";
import { linkPressOf } from "./use-open-link.js";

/**
 * agent-published.tsx -- what an agent published, on its tab: the pull request's row pinned over the box, or the branch's chip at the box's foot while no pull request stands.
 *
 * Once the agent has opened a pull request, its row stands over the box,
 * docked there the way the to-do list is (`agent-tab.tsx`), whether the
 * agent is still at work or has ended, and never in the transcript, so it
 * is always in reach and drawn once. The row wears the pull request's mark
 * (`pull-request-mark.tsx`) and says the number and title, that the checks
 * failed where they did, where the pull request stands only where that
 * changes what the developer would do, and the lines added and removed. A
 * press of it opens its Pull request tab in the side panel
 * (`agent-pull-request-tab.tsx`) where a panel takes it, and GitHub's page
 * otherwise; a right-click offers what a press does not: copying its
 * GitHub link, the branch's name, or the command that checks it out, and
 * the pull request on GitHub, where the press opened its tab. The pointer resting on it hangs the
 * card the pull request's chip hangs (`mention-chip.tsx`): its key and
 * state, size, who opened it and when, branches, labels, and counts, as
 * the workspace's GitHub App answers them (`use-link-standing.ts`).
 *
 * With a branch pushed and no pull request yet, the box's foot wears a
 * chip naming the branch instead, after the + and in the composer's pill
 * (`../chip.tsx`), its name in the code face: a press opens it compared on
 * GitHub, and its ⋯ and right-click offer the same copies and Open on GitHub. A composer too narrow
 * for its words draws the chip's mark alone, its hint and label still
 * naming it; the chip stands in a box of the composer's own that its ⋯
 * finds it by. Nothing here is drawn before the service has said what
 * stands, so a tab on an agent still reading the repository wears nothing
 * yet.
 */

/** The doors the chip and the row open: a page of GitHub's in the browser, and the clipboard, its toast reading `label`. */
export interface PublishedDoors {
  openGitHub: (url: string) => void;
  copy: (words: string, label: string) => void;
  /** Opens the agent's pull request in a tab of the side panel's own; none where the view stands in no panel. */
  openPullRequest?: (() => void) | undefined;
}

const MENU_LABEL = "Branch actions";
/** What the branch's chip is, which names its ⋯. */
const BRANCH_THING = "Branch";
/** What the pull request's row is, which names its ⋯ and its menu. */
const PUBLISHED_THING = "Pull request";
const CHECKS_FAILING = "Checks failing";

/** A pull request's state and lines, its mark first, a glyph's gap apart. */
export const PUBLISHED_META_CLASS = "agent-published-meta inline-flex items-center gap-icon-gap";

/**
 * What a ⋯ and right-click offer: the pull request's address on GitHub, its
 * Copy GitHub link, where one stands, and the branch's name and the command
 * that checks it out, each to the clipboard, where a branch is named; then
 * `opens`, a page of GitHub's, opened there.
 */
function branchActions(
  branch: string | null,
  doors: PublishedDoors,
  pullRequestUrl: string | undefined,
  opens: string | undefined,
): MenuAction[][] {
  const copies: MenuAction[] = [
    ...(pullRequestUrl === undefined
      ? []
      : [
          commandAction(
            PANEL_COMMAND.COPY_GITHUB_LINK,
            () => doors.copy(pullRequestUrl, LINK_COPY.COPIED),
            false,
          ),
        ]),
    ...(branch === null
      ? []
      : [
          {
            label: "Copy branch name",
            icon: <GLYPH.COPY />,
            onSelect: () => doors.copy(branch, "Branch name copied"),
          },
          {
            label: "Copy checkout command",
            icon: <GLYPH.COPY />,
            onSelect: () => doors.copy(checkoutCommand(branch), "Checkout command copied"),
          },
        ]),
  ];
  const open: MenuAction[] =
    opens === undefined
      ? []
      : [commandAction(PANEL_COMMAND.OPEN_ON_GITHUB, () => doors.openGitHub(opens), false)];
  return [copies, open].filter((group) => group.length > 0);
}

/** What the box's foot wears while a branch stands with no pull request: the branch's chip, which opens it compared on GitHub, and its ⋯, which its right-click drops too, offering the copies and Open on GitHub; nothing otherwise, the pull request's row standing over the box instead. */
export function BranchChip({
  published,
  doors,
  narrow = false,
}: {
  published: AgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  /** Whether the composer is too narrow for the chip's words, so it draws its mark alone. */
  narrow?: boolean;
}): ReactNode {
  const menu = useMenu(true);
  const url = published === undefined ? undefined : publishedUrl(published);
  if (published === undefined || url === undefined) return null;
  const { pullRequest, branch } = published;
  if (pullRequest !== null || branch === null) return null;
  const actions = branchActions(branch, doors, undefined, url);
  return (
    <>
      <span className="contents">
        <Tooltip label={`Open ${branch} on GitHub`}>
          <Chip
            look={CHIP_LOOK.PILL}
            iconOnly={narrow}
            aria-label={branch}
            href={url}
            onClick={(event) => {
              menu.close(false);
              linkPressOf(doors.openGitHub, url)(event);
            }}
            {...menu.contextMenu()}
          >
            <GitBranchIcon aria-hidden="true" />
            <ChipName mono>{branch}</ChipName>
          </Chip>
        </Tooltip>
        <MoreButton thing={BRANCH_THING} size={BUTTON_SIZE.COMPACT} {...menu.trigger()} />
      </span>
      {menu.drawn === undefined ? null : (
        <ActionMenu menu={menu.drawn} groups={actions} label={MENU_LABEL} onClose={menu.close} />
      )}
    </>
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
    <span className="agent-published-lines whitespace-nowrap">
      <CountParts parts={linesCount(additions, deletions)} />
    </span>
  );
}

/** The pull request's row pinned over the box, a card of one row: its number and title, that its checks failed where they did, where it stands if that matters, and the lines it adds and removes; a press opens its tab, or the page on GitHub, a right-click offers the rest, and the pointer resting on it hangs the pull request's chip's card, which names it whole. A narrow row gives up the checks' word, then the lines, before the number (tasks.css). */
export function PublishedRow({
  pullRequest,
  branch,
  doors,
}: {
  pullRequest: AgentPullRequest;
  /** The branch the pull request is from, whose name and checkout its menu copies; none where it is not known. */
  branch: string | null;
  doors: PublishedDoors;
}): ReactNode {
  const state = pullRequestStateWord(pullRequest);
  const inPanel = doors.openPullRequest;
  // Note that Open on GitHub is offered only where a press opens the tab instead.
  const actions = branchActions(
    branch,
    doors,
    pullRequest.url,
    inPanel === undefined ? undefined : pullRequest.url,
  );
  const mentionDoors = useMentionDoors();
  const mention = {
    kind: MENTION_KIND.LINK,
    provider: INTEGRATION_PROVIDER.GITHUB,
    url: pullRequest.url,
  } as const;
  const standing = useLinkStanding(mention, {
    taskId: holderTaskId(mentionDoors.holder),
    workspace: mentionDoors.place.workspace,
  });
  const card = (
    <MentionChipCard
      mention={mention}
      target={pullRequest.url}
      name={pullRequest.title}
      doors={mentionDoors}
      standing={standing}
    />
  );
  return (
    <div className="agent-published">
      <List label="Pull request" variant={LIST_VARIANT.CARD} fingerTall>
        {/* Note that the card stands in the pill's place whatever the title's width, since it names the title whole, the published one where GitHub answered nothing. */}
        <RowHintOptions card={card}>
          <ListRow
            leading={<PullRequestMark pullRequest={pullRequest} />}
            title={pullRequestLabelOf(pullRequest)}
            meta={
              <span className={PUBLISHED_META_CLASS}>
                {pullRequest.checks === CHECK_SUMMARY.FAILING ? (
                  <span className="agent-published-checks text-danger">{CHECKS_FAILING}</span>
                ) : null}
                {state === undefined ? null : <span>{state}</span>}
                <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
              </span>
            }
            hint={{ Hint: RowHint, label: pullRequest.title }}
            onPress={() => {
              if (inPanel === undefined) doors.openGitHub(pullRequest.url);
              else inPanel();
            }}
            menu={rowMenu(PUBLISHED_THING, actions)}
          />
        </RowHintOptions>
      </List>
    </div>
  );
}
