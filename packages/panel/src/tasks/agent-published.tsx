import {
  type AgentPullRequest,
  type AgentPullRequestAnswer,
  CHECK_SUMMARY,
} from "@repo/features/agent-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { MENTION_KIND } from "@repo/features/mention-link";
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
} from "@repo/ui";
import { GitBranchIcon, GLYPH } from "@repo/ui/icons";
import { pullRequestLabelOf } from "@repo/ui/tab-strip-model";
import type { ReactNode } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
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

export interface PublishedDoors {
  openGitHub: (url: string) => void;
  copy: (words: string, label: string) => void;
  openPullRequest?: (() => void) | undefined;
}

const MENU_LABEL = "Branch actions";
const BRANCH_THING = "Branch";
const PUBLISHED_THING = "Pull request";
const CHECKS_FAILING = "Checks failing";

export const PUBLISHED_META_CLASS = "agent-published-meta inline-flex items-center gap-icon-gap";

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

export function BranchChip({
  published,
  doors,
  narrow = false,
}: {
  published: AgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  narrow?: boolean;
}): ReactNode {
  const menu = useMenu(true);
  const url = published === undefined ? undefined : publishedUrl(published);
  if (published === undefined || url === undefined) return null;
  const { pullRequest, branch } = published;
  if (pullRequest !== null || branch === null) return null;
  const actions = branchActions(branch, doors, undefined, undefined);
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
        <ActionMenu
          replayUnmasked
          menu={menu.drawn}
          groups={actions}
          label={MENU_LABEL}
          onClose={menu.close}
        />
      )}
    </>
  );
}

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

export function PublishedRow({
  pullRequest,
  branch,
  doors,
}: {
  pullRequest: AgentPullRequest;
  branch: string | null;
  doors: PublishedDoors;
}): ReactNode {
  const state = pullRequestStateWord(pullRequest);
  const coarse = useCoarsePointer();
  const inPanel = doors.openPullRequest;
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
        <RowHintOptions card={card}>
          <ListRow
            leading={<PullRequestMark pullRequest={pullRequest} />}
            title={pullRequestLabelOf(pullRequest)}
            meta={
              <span className={PUBLISHED_META_CLASS}>
                {pullRequest.checks === CHECK_SUMMARY.FAILING ? (
                  <span className="agent-published-checks text-danger">{CHECKS_FAILING}</span>
                ) : null}
                {state === undefined ? null : (
                  <span className="agent-published-state">{state}</span>
                )}
                <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
              </span>
            }
            hint={{ Hint: RowHint, label: pullRequest.title }}
            onPress={() => {
              if (inPanel === undefined) doors.openGitHub(pullRequest.url);
              else inPanel();
            }}
            menu={rowMenu(PUBLISHED_THING, actions, undefined, true)}
            more={!coarse}
          />
        </RowHintOptions>
      </List>
    </div>
  );
}
