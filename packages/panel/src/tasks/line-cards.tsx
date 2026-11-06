import {
  CHECK_STATE,
  type CheckState,
  REVIEW_STATE,
  type ReviewState,
} from "@repo/features/agent-wire";
import { threadLineTitle } from "@repo/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@repo/features/link-grammar";
import {
  DISCLOSURE_FILL,
  type EventNote,
  EventNotes,
  OneLine,
  SUBJECT_FIT,
  type SubjectFit,
  SubjectLine,
} from "@repo/ui";
import { CircleCheckIcon, CircleSlashIcon, GLYPH } from "@repo/ui/icons";
import {
  type CommentLineMetadata,
  GITHUB_CHECK_CONCLUSION,
  GITHUB_LINE_EVENT,
  type GitHubCheckConclusion,
  type GitHubLineMetadata,
  isFailingConclusion,
  type SlackLineMetadata,
  THREAD_LINE_EVENT,
  type ThreadLineMetadata,
} from "@repo/wire";
import { createContext, type ReactNode, useContext } from "react";
import { PLAN_BODY_LAYOUT, Plan, PlanContent, PlanHeader, PlanIcon } from "../ai-elements/plan.js";
import {
  CONCLUSION_WORDS,
  githubChecksFailed,
  githubChecksPassed,
  githubLineChecks,
  githubLineHead,
} from "./agent-model.js";
import { CheckList, CheckRow } from "./agent-pull-request-tab.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { ChipOrLink, linkChip, type MentionDoors } from "./mention-chip.js";
import { ReviewBadge } from "./pull-request-people.js";
import { useMentionDoors } from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * line-cards.tsx -- a line steered into an agent drawn from what its metadata says carried it: a thread's, a comment's, or a Slack message's line under its head, and GitHub's word as its card.
 *
 * A member's reply, answer, or close on a thread reaches the agent as their
 * words under a header naming the item by its title and key, which is the
 * agent's; the transcript heads the words instead with what they did and
 * the thread's chip, which opens it. Each head says what was done as a verb
 * that reads on from the sender's name ("Grace Hopper wrote in" the thread's
 * chip), and opens with it, capitalized, where the line is the reader's own
 * and no name stands before it (`LineLead`). What GitHub said on the agent's pull
 * request reaches the agent as a prompt fenced and closed with what to do
 * about it; the transcript draws it as its own folding card, the one a
 * plan, a continue, and a fork are drawn in (`ai-elements/plan.tsx`), closed
 * as it lands, since its head already says what happened. Its head says who did what to
 * which pull request, by the verdict's own badge from the Pull request
 * tab, or a check event's status, in the icon's seat; its body holds their
 * words as the transcript draws markdown and each inline comment as GitHub
 * heads one, or the Pull request tab's own rows of the checks it names. A
 * card with nothing under its head is its head alone, with no chevron. The
 * instructions and the fence are left to the agent.
 */

/** What a line's head says was done: in lowercase after its sender's name, or opening the line where it is the reader's own. */
interface LineLead {
  readonly AFTER_NAME: string;
  readonly OWN: string;
}

/** The lead for a line another sent, or the reader's own. */
function leadOf(lead: LineLead, received: boolean): string {
  return received ? lead.AFTER_NAME : lead.OWN;
}

/** What a thread's line says the member did on it, by the event its metadata names, so the head reads as a sentence from their name. */
export const THREAD_LINE_DID = {
  [THREAD_LINE_EVENT.MESSAGE]: { AFTER_NAME: "wrote in", OWN: "Wrote in" },
  [THREAD_LINE_EVENT.ANSWER]: { AFTER_NAME: "answered", OWN: "Answered" },
  [THREAD_LINE_EVENT.CLOSE]: { AFTER_NAME: "closed", OWN: "Closed" },
} as const satisfies Record<ThreadLineMetadata["event"], LineLead>;

/** The agent whose transcript is drawn, whose threads its thread lines are on; none where no transcript says. */
export const TranscriptAgent = createContext<string | undefined>(undefined);

/** The link a thread's chip is read from: the item under the agent whose transcript is drawn, on a task's page or the agent's own; none where no agent or workspace names it. */
function threadLink(
  agentId: string | undefined,
  itemId: string,
  doors: MentionDoors,
): string | undefined {
  if (agentId === undefined || doors.place.workspace === "") return undefined;
  return linkOf({ kind: LINK_PLACE.INBOX_ITEM, agentId, itemId }, doors.place.workspace);
}

/**
 * A thread's line's head: what the member did on the thread, and the
 * thread's chip, which opens it, named by the title the line's words carry
 * until the item itself is read, rather than by its kind.
 */
export function ThreadLineHead({
  line,
  words,
  received,
  fit,
}: {
  line: ThreadLineMetadata;
  /** The line's words as the agent read them, whose first line names the item by its title. */
  words: string;
  /** Whether the line is another's, its head following their name (`MessageHead`); the reader's own opens with its lead. */
  received: boolean;
  /** How much of the line the chip takes: the rest of it alone, or its own width beside its sender (`MessageHead`). */
  fit?: SubjectFit | undefined;
}): React.JSX.Element {
  const doors = useMentionDoors();
  const href = threadLink(useContext(TranscriptAgent), line.item_id, doors);
  const chip =
    href === undefined
      ? undefined
      : linkChip(href, threadLineTitle(words, line.event) ?? href, doors);
  return (
    <SubjectLine lead={leadOf(THREAD_LINE_DID[line.event], received)} fit={fit} data-thread-line="">
      {chip}
    </SubjectLine>
  );
}

/** What a comment line leads with, as a thread's leads with what its member did. */
export const COMMENT_LINE_LEAD = {
  AFTER_NAME: "commented on",
  OWN: "Commented on",
} as const satisfies LineLead;

/** What a comment line's chip names where no page does: the plan of the task it is on. */
const PLAN_WORDS = "the description";

/** The link a comment line's chip is read from: the page it is on, or its task's plan; none where no task or workspace names it. */
function commentLink(line: CommentLineMetadata, doors: MentionDoors): string | undefined {
  if (line.task_id === undefined || doors.place.workspace === "") return undefined;
  return line.page_id === undefined
    ? linkOf({ kind: LINK_PLACE.TASK, planId: line.task_id }, doors.place.workspace)
    : linkOf(
        { kind: LINK_PLACE.PAGE, planId: line.task_id, pageId: line.page_id },
        doors.place.workspace,
      );
}

/** What a comment line's head names: the page by its title, or the plan. */
export function commentLineSubject(line: CommentLineMetadata): string {
  return line.page_title ?? PLAN_WORDS;
}

/**
 * The head of a comment thread that reached the agent, drawn in place of the
 * instructions it was handed in, as a thread's line is headed: that it is a
 * comment, and the chip of the plan or page it is on.
 */
export function CommentLineHead({
  line,
  received,
  fit,
}: {
  line: CommentLineMetadata;
  /** Whether the line is another's, its head following their name (`MessageHead`); the reader's own opens with its lead. */
  received: boolean;
  /** How much of the line the chip takes: the rest of it alone, or its own width beside its sender (`MessageHead`). */
  fit?: SubjectFit | undefined;
}): React.JSX.Element {
  const doors = useMentionDoors();
  const href = commentLink(line, doors);
  const chip =
    href === undefined ? commentLineSubject(line) : linkChip(href, commentLineSubject(line), doors);
  return (
    <SubjectLine lead={leadOf(COMMENT_LINE_LEAD, received)} fit={fit} data-comment-line="">
      {chip}
    </SubjectLine>
  );
}

/** What a Slack line leads with: after its sender's name, as GitHub's card says what its author did, or opening the line where it is the reader's own. */
export const SLACK_LINE_LEAD = {
  AFTER_NAME: "wrote in",
  OWN: "Wrote in",
} as const satisfies LineLead;

/** What a Slack line's chip names: Slack, whose mark the chip wears for a link to it. */
export const SLACK_LINE_SUBJECT = "Slack";

/**
 * The head of a member's message to the Slack bot, drawn in place of the
 * prompt the agent was handed: that they wrote it in Slack, and Slack's
 * chip, which opens the message there; Slack in words where Slack answered
 * no link. Its chip takes its own width, so the head ends where the bubble
 * under it does on the reader's own line.
 */
export function SlackLineHead({
  line,
  received,
}: {
  line: SlackLineMetadata;
  /** Whether the line is another's, its head following their name (`MessageHead`); the reader's own opens with its lead. */
  received: boolean;
}): React.JSX.Element {
  const doors = useMentionDoors();
  const chip = line.url === undefined ? undefined : linkChip(line.url, SLACK_LINE_SUBJECT, doors);
  return (
    <SubjectLine lead={leadOf(SLACK_LINE_LEAD, received)} fit={SUBJECT_FIT.OWN} data-slack-line="">
      {chip ?? SLACK_LINE_SUBJECT}
    </SubjectLine>
  );
}

/** Where a check a GitHub line names stands in the Pull request tab's own words, which its row is drawn by: one that failed as failed, one that passed as passed, and the rest as skipped, as the tab reads them. */
function checkStateOf(conclusion: GitHubCheckConclusion): CheckState {
  if (isFailingConclusion(conclusion)) return CHECK_STATE.FAILED;
  return conclusion === GITHUB_CHECK_CONCLUSION.SUCCESS ? CHECK_STATE.PASSED : CHECK_STATE.SKIPPED;
}

/** Where a review left its pull request, by GitHub's own word for its state, as the Pull request tab's badge says it; any other verdict reads as commented. */
const VERDICT_STATE: ReadonlyMap<string, ReviewState> = new Map([
  ["approved", REVIEW_STATE.APPROVED],
  ["changes_requested", REVIEW_STATE.CHANGES_REQUESTED],
]);

/** The ink a card's own mark wears: a failed check's red, a passed one's green, a comment's quiet. */
const MARK_INK = {
  FAILED: "text-destructive",
  PASSED: "text-complete",
  QUIET: "text-muted-foreground",
} as const;

type MarkInk = (typeof MARK_INK)[keyof typeof MARK_INK];

/** A mark in a card's icon's seat, at the size and in the seat the Pull request tab's badge stands in. */
function CardMark({ ink, children }: { ink: MarkInk; children: ReactNode }): React.JSX.Element {
  return (
    <span className={`github-line-mark inline-grid place-items-center [&>svg]:size-ui-12 ${ink}`}>
      {children}
    </span>
  );
}

/** Where a check line's checks stand as one, in the Pull request tab's words: failed where one did, skipped where none passed of those it names, else passed. */
function checksStanding(line: GitHubLineMetadata, words: string): CheckState {
  if (githubChecksFailed(line, words)) return CHECK_STATE.FAILED;
  const checks = line.checks ?? [];
  const nonePassed =
    checks.length > 0 &&
    checks.every((check) => check.conclusion !== GITHUB_CHECK_CONCLUSION.SUCCESS);
  return nonePassed ? CHECK_STATE.SKIPPED : CHECK_STATE.PASSED;
}

/** What a GitHub line wears in its card's icon's seat: a review's verdict as the Pull request tab's badge, a comment's speech mark, a check event's one failed glyph, a skip's quiet slash, or a pass's check, or the failed glyph for the merge queue taking the pull request out. */
function GitHubLineMark({
  line,
  words,
}: {
  line: GitHubLineMetadata;
  words: string;
}): React.JSX.Element {
  switch (line.event) {
    case GITHUB_LINE_EVENT.REVIEW:
      return (
        <ReviewBadge state={VERDICT_STATE.get(line.verdict ?? "") ?? REVIEW_STATE.COMMENTED} />
      );
    case GITHUB_LINE_EVENT.COMMENT:
      return (
        <CardMark ink={MARK_INK.QUIET}>
          <GLYPH.COMMENT />
        </CardMark>
      );
    case GITHUB_LINE_EVENT.CHECK_FAILED:
    case GITHUB_LINE_EVENT.CHECKS_COMPLETED:
      return <ChecksMark standing={checksStanding(line, words)} />;
    case GITHUB_LINE_EVENT.DEQUEUED:
      return <ChecksMark standing={CHECK_STATE.FAILED} />;
  }
}

/** A check event's mark: the one failed glyph in the danger ink, a skip's slash in the quiet ink, or a pass's check in green. */
function ChecksMark({ standing }: { standing: CheckState }): React.JSX.Element {
  if (standing === CHECK_STATE.FAILED) {
    return (
      <CardMark ink={MARK_INK.FAILED}>
        <GLYPH.FAILED />
      </CardMark>
    );
  }
  return standing === CHECK_STATE.SKIPPED ? (
    <CardMark ink={MARK_INK.QUIET}>
      <CircleSlashIcon />
    </CardMark>
  ) : (
    <CardMark ink={MARK_INK.PASSED}>
      <CircleCheckIcon />
    </CardMark>
  );
}

/** How many inline comments a card's head says it holds. */
function commentsWords(count: number): string {
  return count === 1 ? "1 comment" : `${count} comments`;
}

/** The page a card's head links its pull request's chip to: a review's or a comment's own, else the pull request by its number, else the line's checks. */
function pullRequestPage(line: GitHubLineMetadata): string {
  const reviewed =
    line.event === GITHUB_LINE_EVENT.REVIEW || line.event === GITHUB_LINE_EVENT.COMMENT;
  if (reviewed || line.number === undefined) return line.url;
  return `https://github.com/${line.repository}/pull/${line.number}`;
}

/** One inline comment as GitHub heads one: its file's icon, its path linking the comment, and its line, over what the reviewer said. */
function commentNote(
  comment: NonNullable<GitHubLineMetadata["comments"]>[number],
  at: number,
): EventNote {
  const name = comment.path.split("/").at(-1) ?? comment.path;
  return {
    key: String(at),
    glyph: <FileTypeIcon name={name} />,
    where: (
      <>
        <ChipOrLink href={comment.url} words={comment.path} />
        {comment.line === undefined ? null : (
          <span className="text-muted-foreground"> L{comment.line}</span>
        )}
      </>
    ),
    body: comment.body === "" ? null : <TranscriptWords text={comment.body} />,
  };
}

/** The checks a check event names, failures first, as the Pull request tab's own rows, each saying how it ended. */
function GitHubCheckRows({ line }: { line: GitHubLineMetadata }): React.JSX.Element {
  const agentId = useContext(TranscriptAgent) ?? "";
  return (
    <CheckList>
      {githubLineChecks(line).map((check, at) => (
        // Note that two checks may share a name across Apps, so a row is keyed by its place too.
        <CheckRow
          key={`${at}`}
          agentId={agentId}
          live={false}
          says={CONCLUSION_WORDS[check.conclusion]}
          check={{
            name: check.name,
            app: null,
            state: checkStateOf(check.conclusion),
            url: check.url ?? null,
            startedAt: null,
            completedAt: null,
          }}
        />
      ))}
    </CheckList>
  );
}

/**
 * What GitHub said on the agent's pull request, as the transcript's folding
 * card: its mark in the icon's seat, then, beside the head that folds it
 * since a chip is a control a summary may not hold, who did it by their
 * chip, what they did, the pull request's chip, and how many inline
 * comments it holds; under it, their words and each comment, the fourth on
 * behind the list's own foot, or the checks it names. A review that only
 * commented reads "reviewed" under the Pull request tab's Commented badge,
 * and a comment "commented on" under a speech mark, as the tab tells them
 * apart. A card with nothing under its head, an approval with no words or
 * every check passing, is its head alone; a check event whose checks were
 * skipped rather than passed holds their rows, under a quiet mark.
 */
export function GitHubLineCard({
  line,
  words,
  sender,
}: {
  line: GitHubLineMetadata;
  /** The words the line told the agent, which say whether a check failed on a line kept before its metadata did. */
  words: string;
  /** Who sent it, by their chip; none where the transcript names nobody. */
  sender: ReactNode;
}): React.JSX.Element {
  const doors = useMentionDoors();
  const head = githubLineHead(line, words);
  const said = line.words ?? "";
  const comments = line.comments ?? [];
  const checks = githubLineChecks(line);
  // Note that a check event holds its rows only where a check did not pass, because every check passing is said whole by its head.
  const rows = checks.length > 0 && !githubChecksPassed(line, words);
  const folds = said !== "" || comments.length > 0 || rows;
  const count = comments.length === 0 ? "" : commentsWords(comments.length);
  // Note that a check event's head is its words alone, capitalized, as its copy reads, because what failed or passed is no act of whoever posted the checks: "github-actions a check failed on" reads as no sentence.
  const checked =
    line.event === GITHUB_LINE_EVENT.CHECK_FAILED ||
    line.event === GITHUB_LINE_EVENT.CHECKS_COMPLETED;
  const by = checked ? null : sender;
  const does = checked ? head.event : head.does;
  const named = checked ? `${head.event} ${head.target}` : `${line.by} ${head.does} ${head.target}`;
  return (
    <Plan
      data-github-line={line.event}
      // Note that a card that is its head alone holds its fold shut, since a press would open it onto nothing.
      open={folds ? undefined : false}
      fill={DISCLOSURE_FILL.ACTIONS}
      actions={
        // Note that the head clips with room for the sender's wash, whose ring stands at its edge, so its corners are not cut square.
        // Note that a head too narrow for one line puts what was done on a line of its own under who did it, rather than shrinking a chip under the words beside it; there the count fades first, then the words, and the pull request's chip stays whole.
        <span className="github-line-head flex min-w-0 flex-1 flex-wrap items-baseline gap-x-tight-gap gap-y-tight-gap overflow-clip [overflow-clip-margin:var(--ui-inline-ref-bleed)] py-row-inset">
          {by == null ? null : (
            <span className="inline-flex min-w-0 max-w-full overflow-clip">{by}</span>
          )}
          <span className="flex min-w-0 max-w-full flex-1 basis-auto items-baseline gap-tight-gap whitespace-nowrap">
            <OneLine className="min-w-0 text-muted-foreground">{does}</OneLine>
            <span className="inline-flex flex-none">
              <ChipOrLink href={pullRequestPage(line)} words={head.target} doors={doors} />
            </span>
            {count === "" ? null : (
              <OneLine className="ms-auto min-w-0 shrink-[1000] grow-0 basis-auto ps-tight-gap text-muted-foreground">
                {count}
              </OneLine>
            )}
          </span>
        </span>
      }
    >
      <PlanHeader folds={folds} aria-label={count === "" ? named : `${named}, ${count}`}>
        <PlanIcon>
          <GitHubLineMark line={line} words={words} />
        </PlanIcon>
      </PlanHeader>
      {folds ? (
        <PlanContent layout={PLAN_BODY_LAYOUT.STACK}>
          {said === "" ? null : <TranscriptWords text={said} />}
          <EventNotes notes={comments.map(commentNote)} />
          {rows ? <GitHubCheckRows line={line} /> : null}
        </PlanContent>
      ) : null}
    </Plan>
  );
}
