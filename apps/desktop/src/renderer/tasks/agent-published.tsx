import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
} from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  CopyIcon,
  LIST_VARIANT,
  List,
  ListRow,
  ProviderMark,
  useMenu,
} from "@luke/ui";
import { GitBranchIcon, TerminalIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu";
import { RowHint, RowHintOptions, Tooltip } from "../tooltip";
import {
  checkoutCommand,
  publishedUrl,
  pullRequestNumberLabel,
  pullRequestStateWord,
} from "./coding-agent-model";
import { PullRequestMark } from "./pull-request-mark";

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
 * on GitHub, where the press opened its tab, and copying the branch's name
 * or the command that checks it out.
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
const CHECKS_FAILING = "Checks failing";

/** What a right-click offers: the pull request on GitHub where a press opens its tab instead, then the branch's name and the command that checks it out, each to the clipboard, where a branch is named. */
function branchActions(
  branch: string | null,
  doors: PublishedDoors,
  onGitHub: string | undefined,
): MenuAction[][] {
  const github: MenuAction[][] =
    onGitHub === undefined
      ? []
      : [
          [
            {
              label: "Open on GitHub",
              icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
              onSelect: () => doors.openGitHub(onGitHub),
            },
          ],
        ];
  const copies: MenuAction[][] =
    branch === null
      ? []
      : [
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
      <span className="agent-published-chip">
        <Tooltip label={`Open ${branch} on GitHub`}>
          <Chip
            look={CHIP_LOOK.PILL}
            iconOnly={narrow}
            aria-label={branch}
            onClick={() => {
              menu.close(false);
              doors.openGitHub(url);
            }}
            onContextMenu={menu.contextMenu()}
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
    <span className="agent-published-lines">
      <span className="agent-published-added">+{additions}</span>{" "}
      <span className="agent-published-removed">−{deletions}</span>
    </span>
  );
}

/** The pull request's row pinned over the box, a card of one row: its number and title, that its checks failed where they did, where it stands if that matters, and the lines it adds and removes; a press opens its tab, or the page on GitHub, a right-click offers the rest, and the pointer reads its title whole where it is cut short. A narrow row gives up the checks' word, then the lines, before the number (tasks.css). */
export function PublishedRow({
  pullRequest,
  branch,
  doors,
}: {
  pullRequest: CodingAgentPullRequest;
  /** The branch the pull request is from, whose name and checkout the right-click copies; none where it is not known. */
  branch: string | null;
  doors: PublishedDoors;
}): ReactNode {
  const menu = useMenu(true);
  // Whether the title is cut short, which lets the pointer read it whole.
  const [clipped, setClipped] = useState(false);
  const state = pullRequestStateWord(pullRequest.state);
  const inPanel = doors.openPullRequest;
  const actions = branchActions(branch, doors, inPanel === undefined ? undefined : pullRequest.url);
  return (
    <>
      <div className="agent-published">
        <List label="Pull request" variant={LIST_VARIANT.CARD}>
          <RowHintOptions shown={clipped}>
            <ListRow
              leading={<PullRequestMark pullRequest={pullRequest} />}
              title={
                <>
                  {pullRequestNumberLabel(pullRequest)} · {pullRequest.title}
                </>
              }
              meta={
                <span className="agent-published-meta">
                  {pullRequest.checks === CHECK_SUMMARY.FAILING ? (
                    <span className="agent-published-checks">{CHECKS_FAILING}</span>
                  ) : null}
                  {state === undefined ? null : <span>{state}</span>}
                  <LinesChanged
                    additions={pullRequest.additions}
                    deletions={pullRequest.deletions}
                  />
                </span>
              }
              hint={{ Hint: RowHint, label: pullRequest.title }}
              onTitleClipped={setClipped}
              menuOpen={menu.open !== undefined}
              onPress={() => {
                menu.close(false);
                if (inPanel === undefined) doors.openGitHub(pullRequest.url);
                else inPanel();
              }}
              onContextMenu={actions.length === 0 ? undefined : menu.contextMenu()}
            />
          </RowHintOptions>
        </List>
      </div>
      {menu.drawn === undefined || actions.length === 0 ? null : (
        <ActionMenu menu={menu.drawn} groups={actions} label={MENU_LABEL} onClose={menu.close} />
      )}
    </>
  );
}
