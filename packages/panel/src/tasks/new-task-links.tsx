import type { GitHubIssuePick } from "@luke/features/github-repositories-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import {
  TASK_ISSUE_PROVIDER,
  TASK_ISSUE_RELATION,
  type TaskIssueChoice,
  type TaskIssueRelation,
} from "@luke/features/task-issue-wire";
import {
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  CloseIcon,
  IconButton,
  PROVIDER_MARK_SIZE,
  ProviderMark,
} from "@luke/ui";
import { CircleDotIcon } from "lucide-react";
import { Tooltip } from "../tooltip.js";

/**
 * new-task-links.tsx -- the issues New task links the task it starts to, GitHub's and Linear's, each a chip over the words with its key, its title, the keyword its pull requests write, and the × that lets it go.
 *
 * A link is picked from the Issue chip's menu (`issue-picker-chip.tsx`) and
 * stands as a chip above the card's foot, in the order picked, up to as
 * many as a task links (`TASK_BOUNDS.MAX_ISSUES`). Each chip's Closes /
 * Part of switch says which keyword the coding agent writes of it, `Closes`
 * where the task implements it whole, so the provider settles it as the
 * pull request merges, and `Part of` where it does only some. Starting the
 * task names each by what its provider finds it by, with its relation
 * (`choiceOf`), and the service reads each itself before it links it.
 */

/** One issue the card links: GitHub's or Linear's, and the keyword its pull requests write of it. */
export type NewTaskLink =
  | {
      readonly provider: typeof TASK_ISSUE_PROVIDER.GITHUB;
      readonly issue: GitHubIssuePick;
      readonly relation: TaskIssueRelation;
    }
  | {
      readonly provider: typeof TASK_ISSUE_PROVIDER.LINEAR;
      readonly issue: LinearIssueSummary;
      readonly relation: TaskIssueRelation;
    };

/** What the chips say. */
const LINK_WORDS = {
  [TASK_ISSUE_RELATION.CLOSES]: "Closes",
  [TASK_ISSUE_RELATION.PART_OF]: "Part of",
  RELATION_HINT:
    "Which keyword the agent writes: Closes settles the issue as its pull request merges",
  DROP: "Remove issue",
} as const;

/** The provider's own id for a link's issue, which the menu marks it linked by. */
export function linkIdOf(link: NewTaskLink): string {
  return link.provider === TASK_ISSUE_PROVIDER.GITHUB ? link.issue.nodeId : link.issue.id;
}

/** An issue as a mention and a task's name read it: its key, its title, and its page. */
type MentionedIssue = Pick<LinearIssueSummary, "identifier" | "title" | "url">;

/** A link's issue as a mention and a task's name read it. */
export function linkIssueOf(link: NewTaskLink): MentionedIssue {
  if (link.provider === TASK_ISSUE_PROVIDER.LINEAR) return link.issue;
  const { repository, number, title, url } = link.issue;
  return { identifier: `${repository}#${number}`, title, url };
}

/** A link as a start names it: by what its provider finds it by, with its relation. */
export function choiceOf(link: NewTaskLink): TaskIssueChoice {
  return link.provider === TASK_ISSUE_PROVIDER.GITHUB
    ? {
        provider: TASK_ISSUE_PROVIDER.GITHUB,
        repository: link.issue.repository,
        number: link.issue.number,
        relation: link.relation,
      }
    : { provider: TASK_ISSUE_PROVIDER.LINEAR, id: link.issue.id, relation: link.relation };
}

/** Whether a link's issue is a GitHub issue of a repository other than the one given, which a change of repository lets go. */
export function linkedElsewhere(link: NewTaskLink, repository: string | null): boolean {
  return (
    link.provider === TASK_ISSUE_PROVIDER.GITHUB &&
    link.issue.repository.toLowerCase() !== repository?.toLowerCase()
  );
}

/** The other keyword: a link that closes becomes part of, and back. */
function flipped(relation: TaskIssueRelation): TaskIssueRelation {
  return relation === TASK_ISSUE_RELATION.CLOSES
    ? TASK_ISSUE_RELATION.PART_OF
    : TASK_ISSUE_RELATION.CLOSES;
}

/** One linked issue over the words: its mark, key, title, Closes / Part of switch, and the × that lets it go. */
function LinkChip({
  link,
  disabled,
  onRelation,
  onDrop,
}: {
  link: NewTaskLink;
  disabled: boolean;
  onRelation: (relation: TaskIssueRelation) => void;
  onDrop: () => void;
}): React.JSX.Element {
  const github = link.provider === TASK_ISSUE_PROVIDER.GITHUB;
  return (
    <div className="new-task-issue" data-issue-chip="" data-provider={link.provider}>
      {github ? (
        <CircleDotIcon className="new-task-issue-github" />
      ) : (
        <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} size={PROVIDER_MARK_SIZE.CAPTION} />
      )}
      <span className="new-task-issue-key">
        {github ? `#${link.issue.number}` : link.issue.identifier}
      </span>
      <span className="new-task-issue-title">{link.issue.title}</span>
      <span className="new-task-issue-relation">
        <Tooltip label={LINK_WORDS.RELATION_HINT}>
          <Chip
            look={CHIP_LOOK.FILTER}
            size={CHIP_SIZE.COMPACT}
            aria-label={`${LINK_WORDS[link.relation]}: ${LINK_WORDS.RELATION_HINT}`}
            disabled={disabled}
            onClick={() => onRelation(flipped(link.relation))}
          >
            {LINK_WORDS[link.relation]}
          </Chip>
        </Tooltip>
      </span>
      <span className="new-task-issue-drop">
        <Tooltip label={LINK_WORDS.DROP}>
          <IconButton
            icon={<CloseIcon />}
            label={LINK_WORDS.DROP}
            disabled={disabled}
            onClick={onDrop}
          />
        </Tooltip>
      </span>
    </div>
  );
}

/** The card's links as chips, in the order picked; none where it links none. */
export function NewTaskLinks({
  links,
  disabled,
  onChange,
}: {
  links: readonly NewTaskLink[];
  disabled: boolean;
  onChange: (links: readonly NewTaskLink[]) => void;
}): React.JSX.Element | null {
  if (links.length === 0) return null;
  return (
    <div className="new-task-links">
      {links.map((link, index) => (
        <LinkChip
          key={linkIdOf(link)}
          link={link}
          disabled={disabled}
          onRelation={(relation) =>
            onChange(links.map((each, at) => (at === index ? { ...each, relation } : each)))
          }
          onDrop={() => onChange(links.filter((_, at) => at !== index))}
        />
      ))}
    </div>
  );
}
