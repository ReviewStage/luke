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

interface LineLead {
  readonly AFTER_NAME: string;
  readonly OWN: string;
}

function leadOf(lead: LineLead, received: boolean): string {
  return received ? lead.AFTER_NAME : lead.OWN;
}

export const THREAD_LINE_DID = {
  [THREAD_LINE_EVENT.MESSAGE]: { AFTER_NAME: "wrote in", OWN: "Wrote in" },
  [THREAD_LINE_EVENT.ANSWER]: { AFTER_NAME: "answered", OWN: "Answered" },
  [THREAD_LINE_EVENT.CLOSE]: { AFTER_NAME: "closed", OWN: "Closed" },
} as const satisfies Record<ThreadLineMetadata["event"], LineLead>;

export const TranscriptAgent = createContext<string | undefined>(undefined);

function threadLink(
  agentId: string | undefined,
  itemId: string,
  doors: MentionDoors,
): string | undefined {
  if (agentId === undefined || doors.place.workspace === "") return undefined;
  return linkOf({ kind: LINK_PLACE.INBOX_ITEM, agentId, itemId }, doors.place.workspace);
}

export function ThreadLineHead({
  line,
  words,
  received,
  fit,
}: {
  line: ThreadLineMetadata;
  words: string;
  received: boolean;
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

export const COMMENT_LINE_LEAD = {
  AFTER_NAME: "commented on",
  OWN: "Commented on",
} as const satisfies LineLead;

const DESCRIPTION_WORDS = "the description";

function commentLink(line: CommentLineMetadata, doors: MentionDoors): string | undefined {
  if (line.task_id === undefined || doors.place.workspace === "") return undefined;
  return line.page_id === undefined
    ? linkOf({ kind: LINK_PLACE.TASK, planId: line.task_id }, doors.place.workspace)
    : linkOf(
        { kind: LINK_PLACE.PAGE, planId: line.task_id, pageId: line.page_id },
        doors.place.workspace,
      );
}

export function commentLineSubject(line: CommentLineMetadata): string {
  return line.page_title ?? DESCRIPTION_WORDS;
}

export function CommentLineHead({
  line,
  received,
  fit,
}: {
  line: CommentLineMetadata;
  received: boolean;
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

export const SLACK_LINE_LEAD = {
  AFTER_NAME: "wrote in",
  OWN: "Wrote in",
} as const satisfies LineLead;

export const SLACK_LINE_SUBJECT = "Slack";

export function SlackLineHead({
  line,
  received,
}: {
  line: SlackLineMetadata;
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

function checkStateOf(conclusion: GitHubCheckConclusion): CheckState {
  if (isFailingConclusion(conclusion)) return CHECK_STATE.FAILED;
  return conclusion === GITHUB_CHECK_CONCLUSION.SUCCESS ? CHECK_STATE.PASSED : CHECK_STATE.SKIPPED;
}

const VERDICT_STATE: ReadonlyMap<string, ReviewState> = new Map([
  ["approved", REVIEW_STATE.APPROVED],
  ["changes_requested", REVIEW_STATE.CHANGES_REQUESTED],
]);

const MARK_INK = {
  FAILED: "text-destructive",
  PASSED: "text-complete",
  QUIET: "text-muted-foreground",
} as const;

type MarkInk = (typeof MARK_INK)[keyof typeof MARK_INK];

function CardMark({ ink, children }: { ink: MarkInk; children: ReactNode }): React.JSX.Element {
  return (
    <span className={`github-line-mark inline-grid place-items-center [&>svg]:size-ui-12 ${ink}`}>
      {children}
    </span>
  );
}

function checksStanding(line: GitHubLineMetadata, words: string): CheckState {
  if (githubChecksFailed(line, words)) return CHECK_STATE.FAILED;
  const checks = line.checks ?? [];
  const nonePassed =
    checks.length > 0 &&
    checks.every((check) => check.conclusion !== GITHUB_CHECK_CONCLUSION.SUCCESS);
  return nonePassed ? CHECK_STATE.SKIPPED : CHECK_STATE.PASSED;
}

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

function commentsWords(count: number): string {
  return count === 1 ? "1 comment" : `${count} comments`;
}

function pullRequestPage(line: GitHubLineMetadata): string {
  const reviewed =
    line.event === GITHUB_LINE_EVENT.REVIEW || line.event === GITHUB_LINE_EVENT.COMMENT;
  if (reviewed || line.number === undefined) return line.url;
  return `https://github.com/${line.repository}/pull/${line.number}`;
}

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

function GitHubCheckRows({ line }: { line: GitHubLineMetadata }): React.JSX.Element {
  const agentId = useContext(TranscriptAgent) ?? "";
  return (
    <CheckList>
      {githubLineChecks(line).map((check, at) => (
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

export function GitHubLineCard({
  line,
  words,
  sender,
}: {
  line: GitHubLineMetadata;
  words: string;
  sender: ReactNode;
}): React.JSX.Element {
  const doors = useMentionDoors();
  const head = githubLineHead(line, words);
  const said = line.words ?? "";
  const comments = line.comments ?? [];
  const checks = githubLineChecks(line);
  const rows = checks.length > 0 && !githubChecksPassed(line, words);
  const folds = said !== "" || comments.length > 0 || rows;
  const count = comments.length === 0 ? "" : commentsWords(comments.length);
  const checked =
    line.event === GITHUB_LINE_EVENT.CHECK_FAILED ||
    line.event === GITHUB_LINE_EVENT.CHECKS_COMPLETED;
  const by = checked ? null : sender;
  const does = checked ? head.event : head.does;
  const named = checked ? `${head.event} ${head.target}` : `${line.by} ${head.does} ${head.target}`;
  return (
    <Plan
      data-github-line={line.event}
      open={folds ? undefined : false}
      fill={DISCLOSURE_FILL.ACTIONS}
      actions={
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
