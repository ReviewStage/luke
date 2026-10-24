import type { GitHubIssuePick, IssueState } from "@luke/features/github-repositories-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import {
  TASK_ISSUE_PROVIDER,
  TASK_ISSUE_RELATION,
  type TaskIssueLinkView,
  type TaskIssueRelation,
  type TaskIssueTag,
} from "@luke/features/task-issue-wire";
import {
  CHIP_LOOK,
  CHIP_SIZE,
  CHIP_WIDTH,
  Chip,
  ChipName,
  CloseIcon,
  CONFIRM_LOSS,
  ConfirmDialog,
  dropBelowStart,
  ExternalIcon,
  FailureNote,
  GAP,
  Inline,
  LAYOUT_ELEMENT,
  POPOVER_ALIGN,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  Tooltip,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { CircleDotIcon } from "lucide-react";
import { useState } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { IssueCard } from "./issue-card.js";
import { IssueMark } from "./issue-mark.js";
import { IssuePickerChip } from "./issue-picker-chip.js";
import {
  issueKeyWords,
  linksFull,
  RELATION_DETAIL,
  standingWords,
} from "./task-issue-links-model.js";
import { useLinkStanding } from "./use-link-standing.js";
import { linkPressOf, useOpenLink } from "./use-open-link.js";
import { relinkOf, useTaskIssueLinks } from "./use-task-issue-links.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * task-issue-links.tsx -- a task's linked issues under its status and priority, one chip each in the same look, each dropping the menu that opens it, switches the keyword its pull requests write of it, or unlinks it, and the chip that links one more.
 *
 * Each chip is the issue's live mark, GitHub's for where it stands or
 * Linear's own, its key in the code face, and its title, cut short; its
 * card says where the issue stands now and the keyword its pull requests
 * write, under its repository's key. Its menu, headed by the same, opens the issue with its provider,
 * offers Closes and Part of with the one chosen checked, and unlinks it,
 * which leaves the issue itself as it is with its provider. Unlink asks
 * nothing and offers Undo, which links the issue again; one whose provider
 * did not answer on the read could not be linked again, so its Unlink asks
 * first, in red. Where it
 * stands is read as the row opens and never kept (`use-task-issue-links.ts`),
 * so a link its provider did not answer says no state. Link issue, at the
 * row's end, opens New task's own picker (`issue-picker-chip.tsx`) over the
 * task's repository, the issues it links dimmed, and nothing more once it
 * links as many as a task may. A task with no links shows Link issue alone;
 * one whose workspace offers no issue to link and links none draws no row
 * at all. What did not land
 * is said under the chips, and a read that did not land says so in the
 * row's place with Retry.
 */

/** What the row says. */
const LINKS_WORDS = {
  HEADING: "Linked issues",
  LINK: "Link issue",
  [TASK_ISSUE_RELATION.CLOSES]: "Closes",
  [TASK_ISSUE_RELATION.PART_OF]: "Part of",
  UNLINK: "Unlink",
} as const;

const RELATIONS = [TASK_ISSUE_RELATION.CLOSES, TASK_ISSUE_RELATION.PART_OF] as const;

/** Where an issue opens, by its provider, as its menu's first item says. */
const OPEN_WORDS = {
  [TASK_ISSUE_PROVIDER.GITHUB]: "Open on GitHub",
  [TASK_ISSUE_PROVIDER.LINEAR]: "Open in Linear",
} as const satisfies Record<TaskIssueLinkView["provider"], string>;

/** The provider's mark for where an issue stands: GitHub's for its state, an open mark unread, or Linear's own. */
function LinkMark({
  provider,
  number,
  state,
}: {
  provider: TaskIssueLinkView["provider"];
  /** A GitHub issue's number, which its mark names it by. */
  number: number | undefined;
  /** Where a GitHub issue stands; none where its provider answered nothing. */
  state: IssueState | undefined;
}): React.JSX.Element {
  if (state !== undefined) return <IssueMark issue={{ number: number ?? 0, state }} />;
  if (provider === TASK_ISSUE_PROVIDER.GITHUB) {
    return <CircleDotIcon className="task-issue-link-unread" aria-hidden="true" />;
  }
  return <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} size={PROVIDER_MARK_SIZE.CAPTION} />;
}

/** The mark of a link as its page read it. */
function linkMarkOf(link: TaskIssueLinkView): React.JSX.Element {
  const { standing } = link;
  return (
    <LinkMark
      provider={link.provider}
      number={link.number}
      state={standing?.provider === TASK_ISSUE_PROVIDER.GITHUB ? standing.state : undefined}
    />
  );
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
  repository,
  onOpen,
  onRelate,
  onUnlink,
}: {
  link: TaskIssueLinkView;
  /** The task's repository, which a GitHub issue filed there is called by its number alone. */
  repository: string | null;
  onOpen: () => void;
  onRelate: (relation: TaskIssueRelation) => void;
  onUnlink: () => void;
}): React.JSX.Element {
  const { drawn, close, trigger } = useMenu(true);
  const summary = linkSummary(link);
  const stateWords = standingWords(link.standing);
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
      <Tooltip
        label={`${link.key} ${link.title} · ${summary}`}
        card={
          <IssueCard
            mark={linkMarkOf(link)}
            title={link.title}
            heading={stateWords === undefined ? link.key : `${link.key} · ${stateWords}`}
            note={`${LINKS_WORDS[link.relation]}: ${RELATION_DETAIL[link.relation]}`}
          />
        }
      >
        <Chip
          look={CHIP_LOOK.FIELD}
          width={CHIP_WIDTH.AUTO}
          chevron
          aria-label={`${link.key} ${link.title}: ${summary}`}
          {...trigger(dropBelowStart)}
        >
          {linkMarkOf(link)}
          <span className="task-issue-link-key">{issueKeyWords(link, repository)}</span>
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

/** The provider each tag's issue is held by, as a link mention names it. */
const TAG_INTEGRATION = {
  [TASK_ISSUE_PROVIDER.GITHUB]: INTEGRATION_PROVIDER.GITHUB,
  [TASK_ISSUE_PROVIDER.LINEAR]: INTEGRATION_PROVIDER.LINEAR,
} as const satisfies Record<TaskIssueTag["provider"], string>;

/** A tag's card: the issue's title, key and state as its provider answers them once the card is drawn, and its key alone until then or where it answers nothing. */
function IssueTagCard({
  tag,
  taskId,
  repository,
}: {
  tag: TaskIssueTag;
  taskId: string;
  repository: string | null;
}): React.JSX.Element {
  // Note that the read starts only as the card is drawn, since a Board of tags must not ask a provider for each of them as it opens.
  const standing = useLinkStanding(
    { kind: MENTION_KIND.LINK, provider: TAG_INTEGRATION[tag.provider], url: tag.url },
    { taskId, workspace: "" },
  );
  return (
    <IssueCard
      mark={
        <LinkMark
          provider={tag.provider}
          number={standing?.issue?.number}
          state={standing?.issue?.state}
        />
      }
      title={standing?.title ?? issueKeyWords(tag, repository)}
      heading={standing?.state === undefined ? tag.key : `${tag.key} · ${standing.state}`}
      opener={standing?.opener}
      note={`${LINKS_WORDS[tag.relation]}: ${RELATION_DETAIL[tag.relation]}`}
    />
  );
}

/**
 * A Board card's tag for one issue its task links: the issue's mark and its
 * key, hanging the issue's card as the task page's chips do. A press opens
 * the issue as a link to it does elsewhere (`use-open-link.ts`), never the
 * task. The list carries no title or state, which a provider answers live,
 * so the tag wears the unread mark and its card reads them as it is drawn.
 */
export function TaskIssueTagChip({
  tag,
  taskId,
  repository,
}: {
  tag: TaskIssueTag;
  taskId: string;
  /** The task's repository, which a GitHub issue filed there is called by its number alone. */
  repository: string | null;
}): React.JSX.Element {
  const openLink = useOpenLink();
  return (
    <Tooltip
      label={`${tag.key} · ${LINKS_WORDS[tag.relation]}`}
      card={<IssueTagCard tag={tag} taskId={taskId} repository={repository} />}
      overRow
    >
      <Chip
        look={CHIP_LOOK.PILL}
        size={CHIP_SIZE.COMPACT}
        data-provider={tag.provider}
        href={tag.url}
        onClick={linkPressOf(openLink, tag.url)}
      >
        <LinkMark provider={tag.provider} number={undefined} state={undefined} />
        <ChipName mono>{issueKeyWords(tag, repository)}</ChipName>
      </Chip>
    </Tooltip>
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
  const [doomed, setDoomed] = useState<TaskIssueLinkView>();
  // Note that the question goes with its link, unlinked from another window meanwhile.
  const unlinking = useConfirmDialog(
    {
      subject: doomed !== undefined && (links ?? []).some((link) => link.id === doomed.id),
      surfaceOpen: true,
    },
    (): Promise<ActionResult> =>
      doomed === undefined
        ? Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED })
        : control
            .onUnlink(doomed.id)
            .then((refused) =>
              refused === undefined
                ? { status: ACTION_RESULT_STATUS.ACCEPTED }
                : { status: ACTION_RESULT_STATUS.REJECTED, reason: refused },
            ),
  );
  const unlink = (link: TaskIssueLinkView) => {
    if (relinkOf(link) !== undefined) {
      void control.onUnlink(link.id);
      return;
    }
    setDoomed(link);
    unlinking.ask();
  };
  const question = (
    <ConfirmDialog
      open
      confirm={unlinking}
      question={{
        title: `Unlink ${doomed?.key ?? ""}?`,
        body: "Its provider can't be reached, so it can't be linked again until it can.",
        verb: LINKS_WORDS.UNLINK,
        running: "Unlinking",
        loss: CONFIRM_LOSS.IRREVERSIBLE,
      }}
    />
  );
  const offered = linearIn(workspaceId) !== undefined || githubIn(workspaceId) !== undefined;
  // A first read that did not land says why, rather than standing for a task that links nothing.
  if (links === undefined && note !== undefined) {
    return (
      <section className="task-issue-links" aria-label={LINKS_WORDS.HEADING}>
        <FailureNote onRetry={control.onRetry}>{note}</FailureNote>
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
            repository={repository}
            onOpen={() => openLink(link.url)}
            onRelate={(relation) => control.onRelate(link.id, relation)}
            onUnlink={() => unlink(link)}
          />
        ))}
        {offered ? (
          <li className="task-issue-links-add">
            {/* Note that the chip may stand anywhere along a row that wraps, so its menu hangs from whichever edge leaves it room. */}
            <IssuePickerChip
              trigger={LINKS_WORDS.LINK}
              align={POPOVER_ALIGN.START}
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
      {note === undefined ? null : <FailureNote>{note}</FailureNote>}
      {question}
    </section>
  );
}
