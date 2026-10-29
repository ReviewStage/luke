import {
  CHECK_STATE,
  type CheckState,
  REVIEW_STATE,
  type ReviewState,
} from "@luke/features/agent-wire";
import { THREAD_LINE_LEAD, threadLineTitle } from "@luke/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@luke/features/link-grammar";
import {
  DISCLOSURE_FILL,
  type EventCardNote,
  EventNotes,
  type SubjectFit,
  SubjectLine,
  TEXT_LINK_LOOK,
  TextLink,
} from "@luke/ui";
import { CircleCheckIcon, GLYPH } from "@luke/ui/icons";
import {
  GITHUB_CHECK_CONCLUSION,
  GITHUB_LINE_EVENT,
  type GitHubCheckConclusion,
  type GitHubLineMetadata,
  isFailingConclusion,
  type ThreadLineMetadata,
} from "@luke/wire";
import { createContext, type ReactNode, useContext } from "react";
import { PLAN_BODY_LAYOUT, Plan, PlanContent, PlanHeader, PlanIcon } from "../ai-elements/plan.js";
import {
  CONCLUSION_WORDS,
  githubChecksFailed,
  githubLineChecks,
  githubLineHead,
} from "./agent-model.js";
import { CheckList, CheckRow } from "./agent-pull-request-tab.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { linkChip, type MentionDoors } from "./mention-chip.js";
import { ReviewBadge } from "./pull-request-people.js";
import { useMentionDoors } from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * line-cards.tsx -- a line steered into an agent drawn from what its metadata says carried it: a thread's line under its head, and GitHub's word as its card.
 *
 * A member's reply, answer, or close on a thread reaches the agent as their
 * words under a header naming the item by its title and key, which is the
 * agent's; the transcript heads the words instead with what they did and
 * the thread's chip, which opens it. What GitHub said on the agent's pull
 * request reaches the agent as a prompt fenced and closed with what to do
 * about it; the transcript draws it as its own folding card, the one a
 * plan, a continue, and a fork are drawn in (`ai-elements/plan.tsx`), open
 * as it lands, since the agent acts on it. Its head says who did what to
 * which pull request, by the verdict's own badge from the Pull request
 * tab, or a check event's status, in the icon's seat; its body holds their
 * words as the transcript draws markdown and each inline comment as GitHub
 * heads one, or the Pull request tab's own rows of the checks it names. A
 * card with nothing under its head is its head alone, with no chevron. The
 * instructions and the fence are left to the agent.
 */

/** A link in a card's words, opened as the window opens links: the chip of what it names where the transcript draws one (`linkChip`) and `doors` are given, else the link. */
function CardLink({
  href,
  label,
  doors,
}: {
  href: string;
  label: string;
  /** The doors a chip opens through; none for a link that stays a link, as a note's place does, whose page is a line of the pull request rather than the pull request. */
  doors?: MentionDoors | undefined;
}): ReactNode {
  const openLink = useOpenLink();
  const chip = doors === undefined ? undefined : linkChip(href, label, doors);
  if (chip !== undefined) return chip;
  return (
    <TextLink
      href={href}
      look={TEXT_LINK_LOOK.UNDERLINED}
      onClick={(event) => {
        event.preventDefault();
        openLink(href);
      }}
    >
      {label}
    </TextLink>
  );
}

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
  fit,
}: {
  line: ThreadLineMetadata;
  /** The line's words as the agent read them, whose first line names the item by its title. */
  words: string;
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
    <SubjectLine lead={THREAD_LINE_LEAD[line.event]} fit={fit} data-thread-line="">
      {chip}
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
    <span className={`github-line-mark inline-grid place-items-center [&>svg]:size-luke-12 ${ink}`}>
      {children}
    </span>
  );
}

/** What a GitHub line wears in its card's icon's seat: a review's verdict as the Pull request tab's badge, a comment's speech mark, or a check event's one failed glyph or a pass's check. */
function GitHubLineMark({
  line,
  failed,
}: {
  line: GitHubLineMetadata;
  failed: boolean;
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
      return failed ? (
        <CardMark ink={MARK_INK.FAILED}>
          <GLYPH.FAILED />
        </CardMark>
      ) : (
        <CardMark ink={MARK_INK.PASSED}>
          <CircleCheckIcon />
        </CardMark>
      );
  }
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
): EventCardNote {
  const name = comment.path.split("/").at(-1) ?? comment.path;
  return {
    key: String(at),
    glyph: <FileTypeIcon name={name} />,
    where: (
      <>
        <CardLink href={comment.url} label={comment.path} />
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
 * every check passing, is its head alone.
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
  const failed = githubChecksFailed(line, words);
  // Note that a check event holds its rows only while one failed, because every check passing is said whole by its head.
  const rows = checks.length > 0 && failed;
  const folds = said !== "" || comments.length > 0 || rows;
  const count = comments.length === 0 ? "" : commentsWords(comments.length);
  const named = `${line.by} ${head.does} ${head.target}`;
  return (
    <Plan
      data-github-line={line.event}
      defaultOpen={folds}
      // Note that a card that is its head alone holds its fold shut, since a press would open it onto nothing.
      open={folds ? undefined : false}
      fill={DISCLOSURE_FILL.ACTIONS}
      actions={
        <>
          <span className="github-line-head flex min-w-0 flex-1 items-center gap-tight-gap overflow-hidden whitespace-nowrap">
            {sender == null ? null : <span className="inline-flex min-w-0">{sender}</span>}
            <span className="flex-none text-muted-foreground">{head.does}</span>
            <span className="inline-flex flex-none">
              <CardLink href={pullRequestPage(line)} label={head.target} doors={doors} />
            </span>
          </span>
          {count === "" ? null : <span className="flex-none text-muted-foreground">{count}</span>}
        </>
      }
    >
      <PlanHeader folds={folds} aria-label={count === "" ? named : `${named}, ${count}`}>
        <PlanIcon>
          <GitHubLineMark line={line} failed={failed} />
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
