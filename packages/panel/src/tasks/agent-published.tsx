import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
} from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  CountParts,
  LIST_VARIANT,
  List,
  ListRow,
  linesCount,
  ProviderMark,
  RowHint,
  RowHintOptions,
  Tooltip,
  useMenu,
} from "@luke/ui";
import { GitBranchIcon, GLYPH } from "@luke/ui/icons";
import { pullRequestLabelOf } from "@luke/ui/tab-strip-model";
import type { ReactNode } from "react";
import { LINK_COPY } from "../copy-feedback.js";
import { ActionMenu, type MenuAction, rowMenu } from "../desktop/action-menu.js";
import { checkoutCommand, publishedUrl, pullRequestStateWord } from "./coding-agent-model.js";
import { MentionChipCard } from "./mention-chip.js";
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
 * otherwise; a right-click offers what a press does not: the pull request
 * on GitHub, where the press opened its tab, copying its link, and copying
 * the branch's name or the command that checks it out. The pointer resting on it hangs the
 * card the pull request's chip hangs (`mention-chip.tsx`): its key and
 * state, size, who opened it and when, branches, labels, and counts, as
 * the workspace's GitHub App answers them (`use-link-standing.ts`).
 *
 * With a branch pushed and no pull request yet, the box's foot wears a
 * chip naming the branch instead, after the + and in the composer's pill
 * (`../chip.tsx`), its name in the code face: a press opens it compared on
 * GitHub, and a right-click offers the same copies. A composer too narrow
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
/** What the pull request's row is, which names its ⋯ and its menu. */
const PUBLISHED_THING = "Pull request";
const CHECKS_FAILING = "Checks failing";

/** A pull request's state and lines, its mark first, a glyph's gap apart. */
export const PUBLISHED_META_CLASS = "agent-published-meta inline-flex items-center gap-icon-gap";

/** What a ⋯ and right-click offer: the pull request on GitHub where a press opens its tab instead, and its link to the clipboard, then the branch's name and the command that checks it out, each to the clipboard, where a branch is named. */
function branchActions(
  branch: string | null,
  doors: PublishedDoors,
  pullRequest: { url: string; opensOnGitHub: boolean } | undefined,
): MenuAction[][] {
  const links: MenuAction[] = [];
  if (pullRequest?.opensOnGitHub) {
    links.push({
      label: "Open on GitHub",
      icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
      onSelect: () => doors.openGitHub(pullRequest.url),
    });
  }
  if (pullRequest !== undefined) {
    links.push({
      label: LINK_COPY.LABEL,
      icon: <GLYPH.LINK />,
      onSelect: () => doors.copy(pullRequest.url, LINK_COPY.COPIED),
    });
  }
  const github: MenuAction[][] = links.length === 0 ? [] : [links];
  const copies: MenuAction[][] =
    branch === null
      ? []
      : [
          [
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
          ],
        ];
  return [...github, ...copies];
}

/** What the box's foot wears while a branch stands with no pull request: the branch's chip, which opens it compared on GitHub, its right-click offering the copies; nothing otherwise, the pull request's row standing over the box instead. */
export function BranchChip({
  published,
  doors,
  narrow = false,
}: {
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  /** Whether the composer is too narrow for the chip's words, so it draws its mark alone. */
  narrow?: boolean;
}): ReactNode {
  const menu = useMenu(true);
  const url = published === undefined ? undefined : publishedUrl(published);
  if (published === undefined || url === undefined) return null;
  const { pullRequest, branch } = published;
  if (pullRequest !== null || branch === null) return null;
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
      </span>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          menu={menu.drawn}
          groups={branchActions(branch, doors, undefined)}
          label={MENU_LABEL}
          onClose={menu.close}
        />
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
  pullRequest: CodingAgentPullRequest;
  /** The branch the pull request is from, whose name and checkout its menu copies; none where it is not known. */
  branch: string | null;
  doors: PublishedDoors;
}): ReactNode {
  const state = pullRequestStateWord(pullRequest);
  const inPanel = doors.openPullRequest;
  const actions = branchActions(branch, doors, {
    url: pullRequest.url,
    opensOnGitHub: inPanel !== undefined,
  });
  const mentionDoors = useMentionDoors();
  const mention = {
    kind: MENTION_KIND.LINK,
    provider: INTEGRATION_PROVIDER.GITHUB,
    url: pullRequest.url,
  } as const;
  const standing = useLinkStanding(mention, {
    taskId: mentionDoors.taskId,
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
