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
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  CloseIcon,
  IconButton,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  TEXT_BUTTON_TONE,
  TextButton,
} from "@luke/ui";
import { CircleDotIcon } from "lucide-react";
import { PICKER_ALIGN } from "../settings/picker-row.js";
import { Tooltip } from "../tooltip.js";
import { IssueMark } from "./issue-mark.js";
import { IssuePickerChip } from "./issue-picker-chip.js";
import { linksFull, standingWords } from "./task-issue-links-model.js";
import { useOpenLink } from "./use-open-link.js";
import { useTaskIssueLinks } from "./use-task-issue-links.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * task-issue-links.tsx -- a task's Linked issues box under its name: each GitHub or Linear issue it links, where that issue stands now, the keyword its pull requests write of it, and the press that links one more.
 *
 * Each row is the issue's live mark, GitHub's for where it stands or
 * Linear's own, its key in the code face, its title, which opens the issue,
 * the state its provider answers now in words, a Closes / Part of switch,
 * and the × that unlinks it; the issue itself stays as it is with its
 * provider. Where stands is read as the box opens and never kept
 * (`use-task-issue-links.ts`), so a row its provider did not answer says no
 * state. The head's Link issue opens New task's own picker
 * (`issue-picker-chip.tsx`) over the task's repository, the issues it links
 * dimmed, and nothing more once it links as many as a task may. A task
 * with no links says so quietly beside the button; one whose workspace
 * offers no issue to link and links none draws no box at all. An archived
 * task's box is read only. What did not land is said under the rows, and a
 * read that did not land says so in the box with a Try again.
 */

/** What the box says. */
const LINKS_WORDS = {
  HEADING: "Linked issues",
  LINK: "Link issue",
  NONE: "No linked issues",
  RELATION: "Which keyword its pull requests write",
  [TASK_ISSUE_RELATION.CLOSES]: "Closes",
  [TASK_ISSUE_RELATION.PART_OF]: "Part of",
  UNLINK: "Unlink",
  RETRY: "Try again",
} as const;

/** The Closes / Part of switch's two options. */
const RELATION_ITEMS = [
  { value: TASK_ISSUE_RELATION.CLOSES, label: LINKS_WORDS[TASK_ISSUE_RELATION.CLOSES] },
  { value: TASK_ISSUE_RELATION.PART_OF, label: LINKS_WORDS[TASK_ISSUE_RELATION.PART_OF] },
] as const;

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

/** One linked issue as its row. */
function LinkRow({
  link,
  editable,
  onOpen,
  onRelate,
  onUnlink,
}: {
  link: TaskIssueLinkView;
  editable: boolean;
  onOpen: () => void;
  onRelate: (relation: TaskIssueRelation) => void;
  onUnlink: () => void;
}): React.JSX.Element {
  const state = standingWords(link.standing);
  return (
    <li className="task-issue-link" data-provider={link.provider}>
      <span className="task-issue-link-mark">
        <LinkMark link={link} />
      </span>
      <span className="task-issue-link-key">{link.key}</span>
      <span className="task-issue-link-title">
        <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={onOpen}>
          {link.title}
        </TextButton>
      </span>
      {state === undefined ? null : <span className="task-issue-link-state">{state}</span>}
      <span className="task-issue-link-relation">
        <Tooltip label={LINKS_WORDS.RELATION}>
          <span>
            <ChoiceBar
              label={`${LINKS_WORDS.RELATION}: ${link.key}`}
              items={RELATION_ITEMS}
              value={link.relation}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              size={CHOICE_BAR_SIZE.COMPACT}
              disabled={!editable}
              onChange={(relation) => {
                if (relation !== link.relation) onRelate(relation);
              }}
            />
          </span>
        </Tooltip>
      </span>
      {editable ? (
        <span className="task-issue-link-unlink">
          <Tooltip label={LINKS_WORDS.UNLINK}>
            <IconButton
              icon={<CloseIcon />}
              label={`${LINKS_WORDS.UNLINK} ${link.key}`}
              onClick={onUnlink}
            />
          </Tooltip>
        </span>
      ) : null}
    </li>
  );
}

export function TaskIssueLinks({
  taskId,
  workspaceId,
  repository,
  archived,
  linearIn,
  githubIn,
}: {
  taskId: string;
  /** The workspace the task stands in, whose GitHub and Linear its issues are read through. */
  workspaceId: string;
  /** The task's repository, whose GitHub issues the picker lists. */
  repository: string | null;
  /** Whether the task is archived, so its links read only. */
  archived: boolean;
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
        <header className="task-issue-links-head">
          <span className="task-issue-links-heading">{LINKS_WORDS.HEADING}</span>
          <span className="task-issue-links-none" role="alert">
            {note}
          </span>
          <span className="task-issue-links-retry">
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              size={BUTTON_SIZE.COMPACT}
              onClick={control.onRetry}
            >
              {LINKS_WORDS.RETRY}
            </Button>
          </span>
        </header>
      </section>
    );
  }
  if (links === undefined || (links.length === 0 && !offered)) return null;
  const editable = !archived;
  const linked = new Set(links.map((link) => link.externalId));
  return (
    <section className="task-issue-links" aria-label={LINKS_WORDS.HEADING}>
      <header className="task-issue-links-head">
        <span className="task-issue-links-heading">{LINKS_WORDS.HEADING}</span>
        {links.length === 0 ? (
          <span className="task-issue-links-none">{LINKS_WORDS.NONE}</span>
        ) : null}
        {editable && offered ? (
          <IssuePickerChip
            trigger={LINKS_WORDS.LINK}
            align={PICKER_ALIGN.END}
            linearIn={linearIn}
            githubIn={githubIn}
            issuesIn={() => undefined}
            workspaceId={workspaceId}
            repository={repository}
            linked={linked}
            full={linksFull(links.length)}
            disabled={control.linking}
            onChoose={(issue: LinearIssueSummary) =>
              control.onLink({ provider: TASK_ISSUE_PROVIDER.LINEAR, id: issue.id })
            }
            onChooseOwn={() => undefined}
            onChooseGitHub={(issue: GitHubIssuePick) =>
              control.onLink({
                provider: TASK_ISSUE_PROVIDER.GITHUB,
                repository: issue.repository,
                number: issue.number,
              })
            }
          />
        ) : null}
      </header>
      {links.length === 0 ? null : (
        <ul className="task-issue-links-rows">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              editable={editable}
              onOpen={() => openLink(link.url)}
              onRelate={(relation) => control.onRelate(link.id, relation)}
              onUnlink={() => control.onUnlink(link.id)}
            />
          ))}
        </ul>
      )}
      {note === undefined ? null : (
        <p className="task-issue-links-note" role="alert">
          {note}
        </p>
      )}
    </section>
  );
}
