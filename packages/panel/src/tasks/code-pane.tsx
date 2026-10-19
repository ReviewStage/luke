import type { CodeRef } from "@luke/features/task-wire";
import type { TaskCode, TaskCodeShowing } from "@luke/features/tasks-view";
import { IconButton, SCROLL_FADE_INSET } from "@luke/ui";
import {
  type CodeFeedCall,
  type CodeFeedCallSource,
  codeFeedCalls,
  copiedLines,
  fileRefText,
} from "@luke/voice/code-pane-model";
import { FileInputIcon } from "lucide-react";
import { memo, useLayoutEffect, useRef } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { CopyGlyph, copyHint, useCopyFeedback } from "../copy-feedback.js";
import { MarkdownMessage } from "../markdown-message.js";
import { Tooltip } from "../tooltip.js";
import { CallCheckpoint, CallEnded } from "./call-card.js";
import { CodeLineRows } from "./code-lines.js";
import { FileRef } from "./file-ref.js";
import { useMentionLink } from "./task-mentions.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * code-pane.tsx -- the code Luke put on screen on a task's calls: the side panel's Code tab, every snippet he showed, one card each, in the order he showed them.
 *
 * Luke names a file of the task's repository and the lines that matter as he
 * starts to speak about them; the service reads them from its checkout of
 * the repository, and the host keeps the lines pointed at with a few of the
 * file around them and colours them (`task-code.ts`). The tab draws each
 * as a card: the file's path, Luke's note on why he showed them, those
 * lines numbered from where they sit in the file, and a copy of the lines
 * pointed at, so the feed reads as a walkthrough, a step a card. Two
 * snippets of one file are two cards. The cards stand under the call they
 * were shown on, each call opening at the Checkpoint the Call tab
 * opens it at and, once it has ended, closing on the line the Call tab
 * closes it on, its card on hover, and the feed keeps to its newest card
 * while it is scrolled there, so code shown on a live call lands at the bottom as the
 * transcript's lines do, and scrolling up to read an earlier card leaves
 * it where it is until the developer scrolls back down. Every line here is
 * the repository's, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 */

/** What a card's copy is called, which is its accessible name and its hint. */
const COPY_LABEL = "Copy lines";

/** What a card's button that opens the whole file in a tab is called. */
const OPEN_FILE_LABEL = "Open file";

/**
 * Scrolls `lines` alone until `target` stands in its middle. Note that this
 * is not `scrollIntoView`, because that scrolls every box around the line as
 * well, and the panel often arrives sliding in from past the window's edge,
 * so the window's own layout would be scrolled sideways after it.
 */
export function centreWithin(lines: HTMLElement, target: HTMLElement): void {
  const box = lines.getBoundingClientRect();
  const line = target.getBoundingClientRect();
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

/** How far below the feed's top a card revealed stands, in pixels: the feed's scroll padding, which clears the call's checkpoint stuck there and the fade beneath it. */
function revealTop(list: HTMLElement): number {
  const padding = Number.parseFloat(getComputedStyle(list).scrollPaddingTop);
  return Number.isNaN(padding) ? 0 : padding;
}

/** A card's lines. */
export function CodeLines({ code }: { code: TaskCode }): React.JSX.Element {
  return (
    <div className="code-lines">
      <CodeLineRows firstLine={code.firstLine} lines={code.lines} pointed={code.ref} />
    </div>
  );
}

/**
 * The copy of a card's lines, answered as every copy button in the window is
 * (`copy-feedback.tsx`): the glyph turns to a check for a moment, and the
 * button's name stays its own.
 */
function CopyLinesButton({ lines }: { lines: string }): React.JSX.Element {
  const { state, copy } = useCopyFeedback();
  return (
    <Tooltip label={copyHint(state, COPY_LABEL)}>
      <IconButton
        icon={<CopyGlyph state={state} />}
        label={COPY_LABEL}
        onClick={() => copy(lines)}
      />
    </Tooltip>
  );
}

/**
 * A card's header: the file and the lines pointed at, named as every place
 * names them (`file-ref.tsx`), hanging the file's card and opening it in its
 * tab where the card's file can be; their copy, where the card holds them;
 * and the file's opening again as a button of its own. The Code tab's cards
 * and an inbox item's code are both headed by it.
 */
export function CodeCardHeader({
  codeRef,
  note,
  copied,
  onOpen,
}: {
  codeRef: CodeRef;
  /** Luke's note on the lines, which the file's card says; none where the card has none. */
  note: string | undefined;
  /** The lines a copy carries; none where the card holds no lines yet. */
  copied: string | undefined;
  /** Opens the file on the card's lines; none where the card's file cannot be opened, its path then plain words. */
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <header className="code-card-header">
      <FileRef codeRef={codeRef} note={note} onOpen={onOpen} />
      <span className="code-card-actions">
        {copied === undefined ? null : <CopyLinesButton lines={copied} />}
        {onOpen === undefined ? null : (
          <Tooltip label={OPEN_FILE_LABEL}>
            <IconButton
              icon={<FileInputIcon aria-hidden="true" />}
              label={OPEN_FILE_LABEL}
              onClick={onOpen}
            />
          </Tooltip>
        )}
      </span>
    </header>
  );
}

/**
 * Luke's note on a snippet, as Markdown, a link naming a mention drawn as
 * its chip, as a File tab draws the same note (`file-note.tsx`). Note that
 * it reads the page's mentions itself, so the page drawn again draws the
 * note again rather than the card's lines.
 */
function CodeCardNote({ note }: { note: string }): React.JSX.Element {
  const link = useMentionLink();
  const openLink = useOpenLink();
  return (
    <MarkdownMessage words={note} className="code-card-note" link={link} openLink={openLink} />
  );
}

/** One snippet: its header, Luke's note, where code shown before notes were asked for has none, and the lines themselves. */
function CodeCardContent({
  showing,
  onOpenFile,
}: {
  showing: TaskCodeShowing;
  onOpenFile: (ref: CodeRef, commit?: string) => void;
}): React.JSX.Element {
  const { code } = showing;
  return (
    <article className="code-card" data-call-id={showing.callId} aria-label={fileRefText(code.ref)}>
      <CodeCardHeader
        codeRef={code.ref}
        note={code.note}
        copied={copiedLines(code)}
        onOpen={() => onOpenFile(code.ref, code.commit)}
      />
      {code.note === undefined ? null : <CodeCardNote note={code.note} />}
      <CodeLines code={code} />
    </article>
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
const CodeCard = memo(CodeCardContent, (was, now) => was.showing.callId === now.showing.callId);

/** One call's run: the checkpoint it begins at, each code shown on it, and once it has ended, the line it closes with, as the Call tab draws them (`call-card.tsx`). */
function CodeFeedRun({
  call,
  now,
  onOpenFile,
}: {
  call: CodeFeedCall;
  now: number;
  onOpenFile: (ref: CodeRef, commit?: string) => void;
}): React.JSX.Element {
  return (
    <>
      <CallCheckpoint startedAt={call.startedAt} live={call.live} now={now} caller={call.caller} />
      {call.showings.map((showing) => (
        <CodeCard key={showing.callId} showing={showing} onOpenFile={onOpenFile} />
      ))}
      {call.ended === undefined ? null : (
        <CallEnded line={call.ended} startedAt={call.startedAt} record={call.record} />
      )}
    </>
  );
}

/**
 * The tab: every code shown on the task, under its call, kept scrolled to
 * the newest while the developer has not scrolled away, or to the card a
 * File tab's note asked to be shown.
 */
export function CodePane({
  shown,
  calls,
  onOpenFile,
  reveal,
  onRevealed,
}: {
  shown: readonly TaskCodeShowing[];
  /** The task's calls as the Call tab draws them, which the code is grouped under. */
  calls: readonly CodeFeedCallSource[];
  /** Opens the whole file a card's lines are of in a tab of its own, those lines lit. */
  onOpenFile: (ref: CodeRef, commit?: string) => void;
  /** The call whose card to scroll to, once, as the tab is drawn; none to keep to the newest. */
  reveal?: string | undefined;
  /** Says the card asked for was scrolled to, so the tab drawn again later keeps to the newest. */
  onRevealed?: (() => void) | undefined;
}): React.JSX.Element {
  const now = Date.now();
  const pane = useRef<HTMLElement>(null);
  // Note that this runs after the log has kept to its newest card, and
  // tells the log it was scrolled at once, because a draw before the
  // browser's own scroll event would take it back to the newest.
  useLayoutEffect(() => {
    if (reveal === undefined) return;
    const list = pane.current?.querySelector<HTMLElement>("[role='log']");
    const card = pane.current?.querySelector<HTMLElement>(`[data-call-id="${CSS.escape(reveal)}"]`);
    if (list != null && card != null) {
      const top = card.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTop += top - revealTop(list);
      list.dispatchEvent(new Event("scroll"));
    }
    onRevealed?.();
  }, [reveal, onRevealed]);
  return (
    <section ref={pane} className="code-pane ph-no-capture" aria-label="Code shown">
      <Conversation>
        <ConversationContent className="checkpoint-log" fadeInset={SCROLL_FADE_INSET.BAND}>
          {codeFeedCalls(shown, calls).map((call) => (
            <CodeFeedRun key={call.key} call={call} now={now} onOpenFile={onOpenFile} />
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </section>
  );
}
