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
  CARD_CORNER,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  CloseIcon,
  IconButton,
  OneLine,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  Tooltip,
} from "@luke/ui";
import { IssueCard } from "./issue-card.js";
import { IssueMark } from "./issue-mark.js";
import { RELATION_DETAIL, standingWords } from "./task-issue-links-model.js";

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

/** The mark a link wears: a GitHub issue's for where it stands, as the task page draws it, or Linear's own. */
function LinkMark({ link }: { link: NewTaskLink }): React.JSX.Element {
  if (link.provider === TASK_ISSUE_PROVIDER.LINEAR) {
    return (
      <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} size={PROVIDER_MARK_SIZE.CAPTION} />
    );
  }
  return <IssueMark issue={link.issue} />;
}

/** A link's card: its issue's, under its key with where it stands, and the keyword its pull requests write of it. */
function LinkCard({ link }: { link: NewTaskLink }): React.JSX.Element {
  const github = link.provider === TASK_ISSUE_PROVIDER.GITHUB;
  const key = github ? `${link.issue.repository}#${link.issue.number}` : link.issue.identifier;
  const state = github
    ? standingWords({ provider: link.provider, state: link.issue.state })
    : link.issue.state;
  const author = link.provider === TASK_ISSUE_PROVIDER.GITHUB ? link.issue.author : undefined;
  return (
    <IssueCard
      mark={<LinkMark link={link} />}
      title={link.issue.title}
      heading={state === undefined ? key : `${key} · ${state}`}
      opener={author === undefined ? undefined : { login: author, bot: author.endsWith("[bot]") }}
      note={`${LINK_WORDS[link.relation]}: ${RELATION_DETAIL[link.relation]}`}
    />
  );
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
    <Tooltip label={link.issue.title} card={<LinkCard link={link} />}>
      <Card
        look={CARD_LOOK.OUTLINE}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.NONE}
        className="new-task-issue"
        data-issue-chip=""
        data-provider={link.provider}
      >
        <LinkMark link={link} />
        {/* Note that the repository is in the card, because the chip reads `#N title` as every chip of an issue does. */}
        <span className="new-task-issue-name">
          <span className="new-task-issue-key">
            {github ? `#${link.issue.number}` : link.issue.identifier}
          </span>
          <OneLine className="new-task-issue-title" words={link.issue.title}>
            {link.issue.title}
          </OneLine>
        </span>
        <span className="new-task-issue-relation">
          <Tooltip label={RELATION_DETAIL[link.relation]}>
            <Chip
              look={CHIP_LOOK.FILTER}
              size={CHIP_SIZE.COMPACT}
              aria-label={`${LINK_WORDS[link.relation]}: ${RELATION_DETAIL[link.relation]}`}
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
      </Card>
    </Tooltip>
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
