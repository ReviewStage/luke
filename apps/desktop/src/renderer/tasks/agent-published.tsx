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
import { FileDiffIcon, GitBranchIcon, TerminalIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu";
import { RowHint, RowHintOptions, Tooltip } from "../tooltip";
import {
  checkoutCommand,
  publishedUrl,
  pullRequestNumberLabel,
  pullRequestStateWord,
} from "./coding-agent-model";
import { PULL_REQUEST_TONE, PullRequestMark, pullRequestMarkLabel } from "./pull-request-mark";

/**
 * agent-published.tsx -- what an agent published, on its tab: the pull request or branch chip at the box's foot, and the pull request's row at a finished transcript's end.
 *
 * The box's foot wears one of two chips once the agent has pushed, after
 * the + and in the composer's pill (`../chip.tsx`), since each names a
 * thing the agent made rather than a setting the quiet model chip at the
 * foot's other end picks: one for its pull request, its mark
 * (`pull-request-mark.tsx`) and its number in the mark's colour; or, with
 * a branch and no pull request yet, one naming the branch. A press of the
 * pull request's opens its Pull request tab in the side panel
 * (`agent-pull-request-tab.tsx`) where a panel takes it, and GitHub's page
 * otherwise; a press of the branch's opens it compared on GitHub; and a
 * right-click offers what a press does not: the pull request on GitHub,
 * where the press opened its tab, and copying the branch's name or the
 * command that checks it out. The row wears the same mark and says the
 * number and title, that the checks failed where they did, the lines added
 * and removed, and where the pull request stands only where that changes what the developer would
 * do; a press of it opens the pull request. Nothing here is drawn before
 * the service has said what stands, so a tab on an agent still reading the
 * repository wears nothing yet. Beside the pull request's chip stands a
 * Changes chip, which opens the pull request's files and their diffs in
 * the side panel (`agent-changes-tab.tsx`). A composer too narrow for
 * their words draws each chip's mark alone, its hint and label still
 * naming it. Each chip is `@luke/ui`'s pill, the pull request's in the
 * tone of where it stands and a branch's name in the code face, in a box
 * of the composer's own that its ⋯ finds it by.
 */

/** The doors the chip and the row open: a page of GitHub's in the browser, and the clipboard, its toast reading `label`. */
export interface PublishedDoors {
  openGitHub: (url: string) => void;
  copy: (words: string, label: string) => void;
  /** Opens the agent's changes in a tab of the side panel's own; none where the view stands in no panel. */
  openChanges?: (() => void) | undefined;
  /** Opens the agent's pull request in a tab of the side panel's own; none where the view stands in no panel. */
  openPullRequest?: (() => void) | undefined;
}

const MENU_LABEL = "Branch actions";
const CHECKS_FAILING = "Checks failing";

/** What the chip's right-click offers: the pull request on GitHub where a press opens its tab instead, then the branch's name and the command that checks it out, each to the clipboard. */
function branchActions(
  branch: string,
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
  return [
    ...github,
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
        <PullRequestMark pullRequest={published.pullRequest} />
        <ChipName>{pullRequestNumberLabel(published.pullRequest)}</ChipName>
      </>
    );
  }
  return (
    <>
      <GitBranchIcon aria-hidden="true" />
      <ChipName mono>{published.branch}</ChipName>
    </>
  );
}

/** What the box's foot wears for what stands: the pull request's chip, else the branch's, else nothing; a press opens the pull request's tab, or the page on GitHub, and a right-click offers the rest. */
export function PublishedChip({
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
  const label = pullRequest !== null ? pullRequestMarkLabel(pullRequest) : (branch ?? "");
  // Named in the hint too, since a narrow composer draws the chip's mark alone.
  const opens = pullRequest !== null ? pullRequestNumberLabel(pullRequest) : (branch ?? "");
  const inPanel = pullRequest === null ? undefined : doors.openPullRequest;
  return (
    <>
      <span className="agent-published-chip">
        <Tooltip label={inPanel === undefined ? `Open ${opens} on GitHub` : `Show ${opens}`}>
          <Chip
            look={CHIP_LOOK.PILL}
            tone={pullRequest === null ? undefined : PULL_REQUEST_TONE[pullRequest.state]}
            iconOnly={narrow}
            aria-label={label}
            onClick={() => {
              menu.close(false);
              if (inPanel === undefined) doors.openGitHub(url);
              else inPanel();
            }}
            onContextMenu={branch === null ? undefined : menu.contextMenu()}
          >
            <PublishedFace published={published} />
          </Chip>
        </Tooltip>
      </span>
      {menu.drawn === undefined || branch === null ? null : (
        <ActionMenu
          menu={menu.drawn}
          groups={branchActions(branch, doors, inPanel === undefined ? undefined : url)}
          label={MENU_LABEL}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The chip that opens the pull request's changes in the side panel, worn beside its own chip; nothing before a pull request stands or where no panel takes the tab. */
export function ChangesChip({
  published,
  doors,
  narrow = false,
}: {
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  /** Whether the composer is too narrow for the chip's words, so it draws its mark alone. */
  narrow?: boolean;
}): ReactNode {
  const { openChanges } = doors;
  if (published === undefined || published.pullRequest === null || openChanges === undefined) {
    return null;
  }
  return (
    <span className="agent-changes-chip">
      <Tooltip label="Show changes">
        <Chip
          look={CHIP_LOOK.PILL}
          iconOnly={narrow}
          aria-label="Show changes"
          onClick={openChanges}
        >
          <FileDiffIcon aria-hidden="true" />
          <ChipName>Changes</ChipName>
        </Chip>
      </Tooltip>
    </span>
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

/** The row at the end of a finished transcript, a card of one row: the pull request's number and title, that its checks failed where they did, the lines it adds and removes, and where it stands if that matters; a press opens it, and the pointer reads its title whole where it is cut short. A narrow row gives up the checks' word, then the lines, before the number (tasks.css). */
export function PublishedRow({
  pullRequest,
  openGitHub,
}: {
  pullRequest: CodingAgentPullRequest;
  openGitHub: (url: string) => void;
}): ReactNode {
  // Whether the title is cut short, which lets the pointer read it whole.
  const [clipped, setClipped] = useState(false);
  const state = pullRequestStateWord(pullRequest.state);
  return (
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
                <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
              </span>
            }
            hint={{ Hint: RowHint, label: pullRequest.title }}
            onTitleClipped={setClipped}
            onPress={() => openGitHub(pullRequest.url)}
          />
        </RowHintOptions>
      </List>
    </div>
  );
}
