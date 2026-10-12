import type { CodeRef } from "@sidecar/hosted/plan-wire";
import type { CodeToken, PlanCode, PlanCodeShowing } from "@sidecar/hosted/planning-view";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { AudioLinesIcon, FileInputIcon } from "lucide-react";
import { type CSSProperties, Fragment, memo, type ReactNode, useLayoutEffect, useRef } from "react";
import { Checkpoint } from "../ai-elements/checkpoint";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { CopyGlyph, copyHint, useCopyFeedback } from "../copy-feedback";
import { FIND_SKIP_ATTRIBUTE } from "../find-matches";
import { Tooltip } from "../tooltip";
import {
  type CodeFeedCall,
  type CodeFeedCallSource,
  codeFeedCalls,
  copiedLines,
  isPointed,
  rangeLabel,
} from "./code-pane-model";
import { callHeading } from "./transcript-model";

/**
 * code-pane.tsx -- the code Luke put on screen on a plan's calls: the side panel's Code tab, every snippet he showed, one card each, in the order he showed them.
 *
 * Luke names a file of the plan's repository and the lines that matter as he
 * starts to speak about them; the service reads them from its checkout of
 * the repository, and the host keeps the lines pointed at with a few of the
 * file around them and colours them (`plan-code.ts`). The tab draws each
 * as a card: the file's path, Luke's note on why he showed them, those
 * lines numbered from where they sit in the file, and a copy of the lines
 * pointed at, so the feed reads as a walkthrough, a step a card. Two
 * snippets of one file are two cards. The cards stand under the call they
 * were shown on, each call opening at the Checkpoint the Transcript tab
 * opens it at, and the feed keeps to its newest card while it is scrolled
 * there, so code shown on a live call lands at the bottom as the
 * transcript's lines do, and scrolling up to read an earlier card leaves
 * it where it is until the developer scrolls back down. Every line here is
 * the repository's, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 */

/** What a call's checkpoint says while the call stands, as the Transcript tab says it. */
const LIVE_LABEL = "Live";

/** What a card's copy is called, which is its accessible name and its hint. */
const COPY_LABEL = "Copy lines";

/** What a card's button that opens the whole file in a tab is called. */
const OPEN_FILE_LABEL = "Open file";

/**
 * A run's colour in each appearance, as the properties `planning.css` picks
 * between, so the code follows the appearance without being drawn again;
 * nothing for a run in the theme's own foreground.
 */
export function runColours({ color, lightColor }: CodeToken): CSSProperties | undefined {
  if (color === undefined && lightColor === undefined) return undefined;
  const colours: Record<string, string> = {};
  if (color !== undefined) colours["--run-dark"] = color;
  if (lightColor !== undefined) colours["--run-light"] = lightColor;
  return cssCustomProperties(colours);
}

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

/** Lines of a file, numbered from where they sit in it, the lines `pointed` names lit: a card's, and a File tab's, which draws its notes before the lines they begin on. */
export function CodeLineRows({
  firstLine,
  lines,
  pointed,
  before,
}: {
  firstLine: number;
  lines: PlanCode["lines"];
  pointed: CodeRef;
  /** What stands before a line, by its number; nothing where absent. */
  before?: ((line: number) => ReactNode) | undefined;
}): React.JSX.Element {
  return (
    <>
      {lines.map((tokens, index) => {
        const line = firstLine + index;
        return (
          // Note that a line's place in the file is its identity: the lines never reorder.
          <Fragment key={line}>
            {before?.(line)}
            <div className="code-line" data-pointed={String(isPointed(pointed, line))}>
              <span className="code-line-number" {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>
                {line}
              </span>
              <code className="code-line-text">
                {tokens.map((token, at) => (
                  <span key={at} style={runColours(token)}>
                    {token.text}
                  </span>
                ))}
              </code>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

/** How far below the feed's top a card revealed stands, in pixels: clear of the call's checkpoint, which sticks there. */
const REVEAL_TOP_PX = 44;

/** A card's lines. */
export function CodeLines({ code }: { code: PlanCode }): React.JSX.Element {
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
      <button
        type="button"
        className="icon-button code-card-action"
        aria-label={COPY_LABEL}
        onClick={() => copy(lines)}
      >
        <CopyGlyph state={state} />
      </button>
    </Tooltip>
  );
}

/** What a card is called: its path, and the lines pointed at where it names some. */
export function codeCardName(ref: CodeRef): string {
  const label = rangeLabel(ref);
  return label === undefined ? ref.path : `${ref.path}, ${label}`;
}

/**
 * A card's header: its path, cut from the left so the file's own name stays
 * in sight, with the whole path in its hint; the lines pointed at; their
 * copy, where the card holds them; and the whole file opened in a tab of
 * its own, from the path or its button, where the card's file can be. The Code tab's cards and an inbox
 * item's code are both headed by it.
 */
export function CodeCardHeader({
  codeRef,
  copied,
  onOpen,
}: {
  codeRef: CodeRef;
  /** The lines a copy carries; none where the card holds no lines yet. */
  copied: string | undefined;
  /** Opens the whole file; none where the card's file cannot be opened, its path then plain words. */
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  const label = rangeLabel(codeRef);
  return (
    <header className="code-card-header">
      <Tooltip label={codeRef.path}>
        {onOpen === undefined ? (
          <span className="code-card-path">
            <bdi>{codeRef.path}</bdi>
          </span>
        ) : (
          <button
            type="button"
            className="code-card-path"
            aria-label={`Open ${codeRef.path}`}
            onClick={onOpen}
          >
            <bdi>{codeRef.path}</bdi>
          </button>
        )}
      </Tooltip>
      {label === undefined ? null : <span className="code-card-range">{label}</span>}
      <span className="code-card-actions">
        {copied === undefined ? null : <CopyLinesButton lines={copied} />}
        {onOpen === undefined ? null : (
          <Tooltip label={OPEN_FILE_LABEL}>
            <button
              type="button"
              className="icon-button code-card-action"
              aria-label={OPEN_FILE_LABEL}
              onClick={onOpen}
            >
              <FileInputIcon aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </span>
    </header>
  );
}

/** One snippet: its header, Luke's note, where code shown before notes were asked for has none, and the lines themselves. */
function CodeCardContent({
  showing,
  onOpenFile,
}: {
  showing: PlanCodeShowing;
  onOpenFile: (ref: CodeRef) => void;
}): React.JSX.Element {
  const { code } = showing;
  return (
    <article
      className="code-card"
      data-call-id={showing.callId}
      aria-label={codeCardName(code.ref)}
    >
      <CodeCardHeader
        codeRef={code.ref}
        copied={copiedLines(code)}
        onOpen={() => onOpenFile(code.ref)}
      />
      {code.note === undefined ? null : <p className="code-card-note">{code.note}</p>}
      <CodeLines code={code} />
    </article>
  );
}

/**
 * A card, drawn again only for another call's code. Note that the call is
 * the whole comparison, because a `show_code` call's lines never change once
 * it has answered, while the view carrying them arrives anew with every
 * word of the call's activity: a plan with hundreds of snippets would
 * otherwise redraw each of them several times a second. Its opening of a
 * file is the panel's own, which is the same door from one draw to the next.
 */
const CodeCard = memo(CodeCardContent, (was, now) => was.showing.callId === now.showing.callId);

/** One call's run: the checkpoint it begins at, then each code shown on it. */
function CodeFeedRun({
  call,
  now,
  onOpenFile,
}: {
  call: CodeFeedCall;
  now: number;
  onOpenFile: (ref: CodeRef) => void;
}): React.JSX.Element {
  return (
    <>
      <Checkpoint
        trailing={
          call.live ? (
            <span className="flex items-center gap-1.5 text-developer">
              <AudioLinesIcon className="size-3.5" aria-hidden="true" />
              {LIVE_LABEL}
            </span>
          ) : null
        }
      >
        {callHeading(call.startedAt, now)}
      </Checkpoint>
      {call.showings.map((showing) => (
        <CodeCard key={showing.callId} showing={showing} onOpenFile={onOpenFile} />
      ))}
    </>
  );
}

/**
 * The tab: every code shown on the plan, under its call, kept scrolled to
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
  shown: readonly PlanCodeShowing[];
  /** The plan's calls as the Transcript tab draws them, which the code is grouped under. */
  calls: readonly CodeFeedCallSource[];
  /** Opens the whole file a card's lines are of in a tab of its own, those lines lit. */
  onOpenFile: (ref: CodeRef) => void;
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
      list.scrollTop += top - REVEAL_TOP_PX;
      list.dispatchEvent(new Event("scroll"));
    }
    onRevealed?.();
  }, [reveal, onRevealed]);
  return (
    <section ref={pane} className="code-pane ph-no-capture" aria-label="Code shown">
      <Conversation>
        {/* No top padding, because a sticky checkpoint would leave what scrolled under it showing in that band. */}
        <ConversationContent className="pt-0">
          {codeFeedCalls(shown, calls).map((call) => (
            <CodeFeedRun key={call.key} call={call} now={now} onOpenFile={onOpenFile} />
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </section>
  );
}
