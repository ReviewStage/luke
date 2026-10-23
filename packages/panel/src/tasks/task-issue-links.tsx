import type { GitHubIssuePick } from "@luke/features/github-repositories-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import {
  TASK_ISSUE_PROVIDER,
  TASK_ISSUE_RELATION,
  type TaskIssueLinkView,
  type TaskIssueRelation,
} from "@luke/features/task-issue-wire";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  CloseIcon,
  dropBelowStart,
  ExternalIcon,
  GAP,
  Inline,
  LAYOUT_ELEMENT,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  TEXT_BUTTON_TONE,
  TextButton,
  Tooltip,
  useMenu,
} from "@luke/ui";
import { CircleDotIcon } from "lucide-react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { PICKER_ALIGN } from "../settings/picker-row.js";
import { IssueMark } from "./issue-mark.js";
import { IssuePickerChip } from "./issue-picker-chip.js";
import { linksFull, RELATION_DETAIL, standingWords } from "./task-issue-links-model.js";
import { useOpenLink } from "./use-open-link.js";
import { useTaskIssueLinks } from "./use-task-issue-links.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * task-issue-links.tsx -- a task's linked issues under its status and priority, one chip each in the same look, each dropping the menu that opens it, switches the keyword its pull requests write of it, or unlinks it, and the chip that links one more.
 *
 * Each chip is the issue's live mark, GitHub's for where it stands or
 * Linear's own, its key in the code face, and its title, cut short; its
 * tooltip says where the issue stands now and the keyword its pull requests
 * write. Its menu, headed by the same, opens the issue with its provider,
 * offers Closes and Part of with the one chosen checked, and unlinks it,
 * which leaves the issue itself as it is with its provider. Where it
 * stands is read as the row opens and never kept (`use-task-issue-links.ts`),
 * so a link its provider did not answer says no state. Link issue, at the
 * row's end, opens New task's own picker (`issue-picker-chip.tsx`) over the
 * task's repository, the issues it links dimmed, and nothing more once it
 * links as many as a task may. A task with no links shows Link issue alone;
 * one whose workspace offers no issue to link and links none draws no row
 * at all. What did not land
 * is said under the chips, and a read that did not land says so in the
 * row's place with a Try again.
 */

/** What the row says. */
const LINKS_WORDS = {
  HEADING: "Linked issues",
  LINK: "Link issue",
  [TASK_ISSUE_RELATION.CLOSES]: "Closes",
  [TASK_ISSUE_RELATION.PART_OF]: "Part of",
  UNLINK: "Unlink",
  RETRY: "Try again",
} as const;

const RELATIONS = [TASK_ISSUE_RELATION.CLOSES, TASK_ISSUE_RELATION.PART_OF] as const;

/** Where an issue opens, by its provider, as its menu's first item says. */
const OPEN_WORDS = {
  [TASK_ISSUE_PROVIDER.GITHUB]: "Open on GitHub",
  [TASK_ISSUE_PROVIDER.LINEAR]: "Open in Linear",
} as const satisfies Record<TaskIssueLinkView["provider"], string>;

/** The provider's mark for where a link's issue stands: GitHub's for its state, an open mark unread, or Linear's own. */
function LinkMark({ link }: { link: TaskIssueLinkView }): React.JSX.Element {
  const { standing } = link;
  if (standing?.provider === TASK_ISSUE_PROVIDER.GITHUB) {
    return <IssueMark issue={{ number: link.number ?? 0, state: standing.state }} />;
  }
  if (link.provider === TASK_ISSUE_PROVIDER.GITHUB) {
    return <CircleDotIcon className="task-issue-link-unread" aria-hidden="true" />;
  }
  return <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} size={PROVIDER_MARK_SIZE.CAPTION} />;
}

/**
 * What a link's chip calls its issue's number: `#42` for a GitHub issue, whose
 * key is `owner/name#42` in the service, and Linear's own key, so the chip
 * reads as every other chip of an issue does and the repository stays in its
 * tooltip.
 */
function keyWords(link: TaskIssueLinkView): string {
  const at = link.key.lastIndexOf("#");
  return link.provider === TASK_ISSUE_PROVIDER.GITHUB && at >= 0 ? link.key.slice(at) : link.key;
}

/** What a link's chip says of it beyond its key and title: where it stands, where its provider answered, and its keyword. */
function linkSummary(link: TaskIssueLinkView): string {
  const state = standingWords(link.standing);
  const keyword = LINKS_WORDS[link.relation];
  return state === undefined ? keyword : `${state} · ${keyword}`;
}

/** One linked issue as its chip, and the menu it drops. */
function LinkChip({
  link,
  onOpen,
  onRelate,
  onUnlink,
}: {
  link: TaskIssueLinkView;
  onOpen: () => void;
  onRelate: (relation: TaskIssueRelation) => void;
  onUnlink: () => void;
}): React.JSX.Element {
  const { drawn, close, trigger } = useMenu(true);
  const summary = linkSummary(link);
  const open: MenuAction = {
    label: OPEN_WORDS[link.provider],
    icon: <ExternalIcon />,
    onSelect: onOpen,
  };
  const relations: MenuAction[] = RELATIONS.map((relation) => ({
    label: LINKS_WORDS[relation],
    detail: RELATION_DETAIL[relation],
    checked: relation === link.relation,
    onSelect: () => {
      if (relation !== link.relation) onRelate(relation);
    },
  }));
  const unlink: MenuAction = {
    label: LINKS_WORDS.UNLINK,
    icon: <CloseIcon />,
    onSelect: onUnlink,
    danger: true,
  };
  return (
    <li className="task-issue-link" data-provider={link.provider} data-relation={link.relation}>
      <Tooltip label={`${link.key} ${link.title} · ${summary}`}>
        <Chip
          look={CHIP_LOOK.FIELD}
          width={CHIP_WIDTH.AUTO}
          chevron
          aria-label={`${link.key} ${link.title}: ${summary}`}
          {...trigger(dropBelowStart)}
        >
          <LinkMark link={link} />
          <span className="task-issue-link-key">{keyWords(link)}</span>
          <ChipName>{link.title}</ChipName>
        </Chip>
      </Tooltip>
      {drawn === undefined ? null : (
        <ActionMenu
          label={`${link.key} ${link.title}`}
          menu={drawn}
          heading={
            <span className="task-issue-link-heading">
              <span className="task-issue-link-heading-title">{link.title}</span>
              <span className="task-issue-link-heading-state">
                {standingWords(link.standing) ?? link.key}
              </span>
            </span>
          }
          groups={[[open], relations, [unlink]]}
          onClose={close}
        />
      )}
    </li>
  );
}

export function TaskIssueLinks({
  taskId,
  workspaceId,
  repository,
  linearIn,
  githubIn,
}: {
  taskId: string;
  /** The workspace the task stands in, whose GitHub and Linear its issues are read through. */
  workspaceId: string;
  /** The task's repository, whose GitHub issues the picker lists. */
  repository: string | null;
  linearIn: TasksControl["newTask"]["linearIssuesIn"];
  githubIn: TasksControl["newTask"]["githubIssuesIn"];
}): React.JSX.Element | null {
  const control = useTaskIssueLinks(taskId);
  const openLink = useOpenLink();
  const { links, note } = control;
  const offered = linearIn(workspaceId) !== undefined || githubIn(workspaceId) !== undefined;
  // A first read that did not land says why, rather than standing for a task that links nothing.
  if (links === undefined && note !== undefined) {
    return (
      <section className="task-issue-links" aria-label={LINKS_WORDS.HEADING}>
        <p className="task-issue-links-note" role="alert">
          {note}{" "}
          <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={control.onRetry}>
            {LINKS_WORDS.RETRY}
          </TextButton>
        </p>
      </section>
    );
  }
  if (links === undefined || (links.length === 0 && !offered)) return null;
  const linked = new Set(links.map((link) => link.externalId));
  return (
    <section className="task-issue-links" aria-label={LINKS_WORDS.HEADING}>
      <Inline as={LAYOUT_ELEMENT.UL} gap={GAP.ITEM} className="task-issue-links-rows">
        {links.map((link) => (
          <LinkChip
            key={link.id}
            link={link}
            onOpen={() => openLink(link.url)}
            onRelate={(relation) => control.onRelate(link.id, relation)}
            onUnlink={() => control.onUnlink(link.id)}
          />
        ))}
        {offered ? (
          <li className="task-issue-links-add">
            {/* Note that the chip may stand anywhere along a row that wraps, so its menu hangs from whichever edge leaves it room. */}
            <IssuePickerChip
              trigger={LINKS_WORDS.LINK}
              align={PICKER_ALIGN.START}
              linearIn={linearIn}
              githubIn={githubIn}
              workspaceId={workspaceId}
              repository={repository}
              linked={linked}
              full={linksFull(links.length)}
              disabled={control.linking}
              onChoose={(issue: LinearIssueSummary) =>
                control.onLink({ provider: TASK_ISSUE_PROVIDER.LINEAR, id: issue.id })
              }
              onChooseGitHub={(issue: GitHubIssuePick) =>
                control.onLink({
                  provider: TASK_ISSUE_PROVIDER.GITHUB,
                  repository: issue.repository,
                  number: issue.number,
                })
              }
            />
          </li>
        ) : null}
      </Inline>
      {note === undefined ? null : (
        <p className="task-issue-links-note" role="alert">
          {note}
        </p>
      )}
    </section>
  );
}
