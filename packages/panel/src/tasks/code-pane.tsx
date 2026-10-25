import type { CodeRef } from "@luke/features/task-wire";
import type { TaskCodeShowing } from "@luke/features/tasks-view";
import { callHeading, WORKED_SEPARATOR } from "@luke/features/time-format";
import { CodeCard, FILL_ELEMENT, Fill, IconButton, SCROLL_FADE_INSET, Tooltip } from "@luke/ui";
import { askScroll } from "@luke/ui/scroll-asked";
import {
  type CodeFeedCall,
  type CodeFeedCallSource,
  codeFeedCalls,
  copiedLines,
  fileRefText,
} from "@luke/voice/code-pane-model";
import { FileInputIcon } from "lucide-react";
import { memo, type ReactNode } from "react";
import { Checkpoint } from "../ai-elements/checkpoint.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { copyThroughShell } from "../copy-feedback.js";
import { CallEndMarker, CallStartMarker } from "./call-card.js";
import { CodeSnippet, useSnippetNote } from "./code-snippet.js";
import { FileRef } from "./file-ref.js";

/**
 * code-pane.tsx -- the code a task's agents put on screen: the side panel's Code tab, every snippet they showed, one card each, in the order they showed them.
 *
 * An agent names a file of the task's repository and the lines that matter
 * as it starts to speak about them; the service reads them from the agent's
 * checkout of the repository, and the host keeps the lines pointed at with a few of the
 * file around them (`task-code.ts`). The tab draws each as a card: the
 * file's path and a copy of the lines pointed at over those lines, drawn
 * and coloured by the diff bundle as View settings draws code, numbered from
 * where they sit in the file, with the agent's note on why it showed them under
 * the last of them (`code-snippet.tsx`), so the feed reads as a
 * walkthrough, a step a card. Two
 * snippets of one file are two cards. Code an agent showed on a turn of its
 * own, typed or spoken, stands under that turn, headed by the agent's name
 * and when the turn began. The cards stand under the call they
 * were shown on, each call opening at the marker an agent's transcript
 * opens it at and, once it has ended, closing on the marker it closes it
 * on, its card on hover, and the feed keeps to its newest card
 * while it is scrolled there, so code shown on a live call lands at the bottom as the
 * transcript's lines do, and scrolling up to read an earlier card leaves
 * it where it is until the developer scrolls back down. Every line here is
 * the repository's, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 * Each card is `@luke/ui`'s `CodeCard`, its header and its Copy the one
 * every block of code in the window has (`FileCodeCard`).
 */

/** What a card's button that opens the whole file in a tab is called. */
const OPEN_FILE_LABEL = "Open file";

/** No agent named, where the pane is drawn with no agents to name. */
const noAgentLabel = (): undefined => undefined;

/**
 * Scrolls `lines` alone until `target` stands in its middle. Note that this
 * is not `scrollIntoView`, because that scrolls every box around the line as
 * well, and the panel often arrives sliding in from past the window's edge,
 * so the window's own layout would be scrolled sideways after it. The
 * scroll is asked for (`askScroll`), so a log it centres a line in leaves
 * its newest line for it.
 */
export function centreWithin(lines: HTMLElement, target: HTMLElement): void {
  const box = lines.getBoundingClientRect();
  const line = target.getBoundingClientRect();
  askScroll(lines);
  lines.scrollTop += line.top + line.height / 2 - (box.top + box.height / 2);
}

/** The nearest box around an element that scrolls, which a reveal scrolls rather than every box around it; none where nothing around it scrolls. */
export function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let box = element.parentElement; box !== null; box = box.parentElement) {
    const { overflowY } = window.getComputedStyle(box);
    if ((overflowY === "auto" || overflowY === "scroll") && box.scrollHeight > box.clientHeight) {
      return box;
    }
  }
  return undefined;
}

/**
 * A file's code as a `CodeCard`: the file and the lines pointed at in its
 * header, named as every place names them (`file-ref.tsx`), hanging the
 * file's card and opening it in its tab where the card's file can be; the
 * file's opening again as a button of its own, and the copy of the lines
 * pointed at, where the card holds them; over `body`, the lines themselves.
 * The Code tab's cards and an inbox item's code are both drawn by it.
 */
export function FileCodeCard({
  codeRef,
  repository,
  note,
  copied,
  onOpen,
  body,
  data,
}: {
  codeRef: CodeRef;
  /** The repository the lines were read from, `owner/name`, which the file's card names. */
  repository: string;
  /** The agent's note on the lines, which the file's card says; none where the card has none. */
  note: string | undefined;
  /** The lines a copy carries; none where the card holds no lines yet, which draws no copy. */
  copied: string | undefined;
  /** Opens the file on the card's lines; none where the card's file cannot be opened, its path then plain words. */
  onOpen: (() => void) | undefined;
  /** What stands under the header: the lines, or why there are none. */
  body: ReactNode;
  /** Data attributes the card is found by: the call that showed the lines, or an Inbox item's code. */
  data?: Readonly<Record<`data-${string}`, string>> | undefined;
}): React.JSX.Element {
  return (
    <CodeCard
      title={<FileRef codeRef={codeRef} repository={repository} note={note} onOpen={onOpen} />}
      label={fileRefText(codeRef)}
      data={data}
      copied={copied}
      copy={copyThroughShell}
      actions={
        onOpen === undefined ? null : (
          <Tooltip label={OPEN_FILE_LABEL}>
            <IconButton
              icon={<FileInputIcon aria-hidden="true" />}
              label={OPEN_FILE_LABEL}
              onClick={onOpen}
            />
          </Tooltip>
        )
      }
      body={body}
    />
  );
}

/** One snippet: its header, then the lines themselves with the agent's note under the last it pointed at, where code shown before notes were asked for has none. */
function ShownCodeContent({
  showing,
  taskId,
  agentLabel,
  onOpenFile,
}: {
  showing: TaskCodeShowing;
  taskId: string | undefined;
  agentLabel: (agentId: string) => string | undefined;
  /** Opens the code's file in a File tab; none where no File tab reads it, as on an agent's page with no task. */
  onOpenFile: ((ref: CodeRef, commit?: string) => void) | undefined;
}): React.JSX.Element {
  const { code } = showing;
  const notes = useSnippetNote(
    code,
    {
      callId: showing.callId,
      turnId: showing.turnId,
      agentId: showing.agentId,
      shownAt: showing.shownAt,
      note: code.note,
    },
    taskId,
    agentLabel,
  );
  return (
    <FileCodeCard
      codeRef={code.ref}
      repository={code.repository}
      note={code.note}
      copied={copiedLines(code)}
      onOpen={onOpenFile === undefined ? undefined : () => onOpenFile(code.ref, code.commit)}
      body={<CodeSnippet code={code} notes={notes} />}
      data={{ "data-call-id": showing.callId }}
    />
  );
}

/**
 * A card, drawn again only for another call's code. Note that the call is
 * the whole comparison, because a `show_code` call's lines never change once
 * it has answered, while the view carrying them arrives anew with every
 * word of the call's activity: a task with hundreds of snippets would
 * otherwise redraw each of them several times a second. Its opening of a
 * file is the panel's own, which is the same door from one draw to the next.
 */
const ShownCode = memo(
  ShownCodeContent,
  (was, now) => was.showing.callId === now.showing.callId && was.taskId === now.taskId,
);

/** The divider an agent's turn begins at: the agent's name and when the turn began, "Invite flow · Today, 3:42 PM", or when alone for an agent the task no longer lists. */
function AgentTurnCheckpoint({
  agent,
  startedAt,
  now,
}: {
  agent: string | undefined;
  startedAt: number;
  now: number;
}): React.JSX.Element {
  const heading = callHeading(startedAt, now);
  return (
    <Checkpoint>
      {agent === undefined ? heading : `${agent}${WORKED_SEPARATOR}${heading}`}
    </Checkpoint>
  );
}

/** One call's or one agent's turn's run: the marker or divider it begins at, each code shown on it, and once a call has ended, the marker it closes with, as an agent's transcript draws them (`call-card.tsx`). */
function CodeFeedRun({
  call,
  now,
  taskId,
  agentLabel,
  onOpenFile,
}: {
  call: CodeFeedCall;
  now: number;
  taskId: string | undefined;
  agentLabel: (agentId: string) => string | undefined;
  /** Opens the code's file in a File tab; none where no File tab reads it, as on an agent's page with no task. */
  onOpenFile: ((ref: CodeRef, commit?: string) => void) | undefined;
}): React.JSX.Element {
  return (
    <>
      {call.agentId === undefined ? (
        <CallStartMarker
          startedAt={call.startedAt}
          live={call.live}
          now={now}
          caller={call.caller}
        />
      ) : (
        <AgentTurnCheckpoint
          agent={agentLabel(call.agentId)}
          startedAt={call.startedAt}
          now={now}
        />
      )}
      {call.showings.map((showing) => (
        <ShownCode
          key={showing.callId}
          showing={showing}
          taskId={taskId}
          agentLabel={agentLabel}
          onOpenFile={onOpenFile}
        />
      ))}
      {call.ended === undefined ? null : (
        <CallEndMarker line={call.ended} startedAt={call.startedAt} record={call.record} />
      )}
    </>
  );
}

/** The tab: every code shown on the task, under its call, kept scrolled to the newest while the developer has not scrolled away. */
export function CodePane({
  shown,
  calls,
  taskId,
  agentLabel = noAgentLabel,
  onOpenFile,
}: {
  shown: readonly TaskCodeShowing[];
  /** The task's calls as the agents' tabs draw them, which the code is grouped under. */
  calls: readonly CodeFeedCallSource[];
  /** The task the code was shown on, whose work a note's link names; none offers no link. */
  taskId?: string | undefined;
  /** An agent on the task as its tab names it, which heads the code its turns showed; none for an agent not listed, whose turn is headed by its time alone. */
  agentLabel?: ((agentId: string) => string | undefined) | undefined;
  /** Opens the whole file a card's lines are of in a tab of its own, those lines lit. */
  /** Opens the code's file in a File tab; none where no File tab reads it, as on an agent's page with no task. */
  onOpenFile: ((ref: CodeRef, commit?: string) => void) | undefined;
}): React.JSX.Element {
  const now = Date.now();
  return (
    <Fill as={FILL_ELEMENT.SECTION} className="code-pane ph-no-capture" aria-label="Code shown">
      <Conversation>
        <ConversationContent className="checkpoint-log pt-0" fadeInset={SCROLL_FADE_INSET.BAND}>
          {codeFeedCalls(shown, calls).map((call) => (
            <CodeFeedRun
              key={call.key}
              call={call}
              now={now}
              taskId={taskId}
              agentLabel={agentLabel}
              onOpenFile={onOpenFile}
            />
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </Fill>
  );
}
