import type { CodeRef } from "@sidecar/hosted/plan-wire";
import type { CodeToken, PlanCode, PlanCodeShowing } from "@sidecar/hosted/planning-view";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { CheckIcon, CopyIcon, FileInputIcon } from "lucide-react";
import { type CSSProperties, memo, useRef, useState } from "react";
import { Checkpoint } from "../ai-elements/checkpoint";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation";
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
const COPIED_LABEL = "Copied";

/** What a card's button that opens the whole file in a tab is called. */
const OPEN_FILE_LABEL = "Open file";

/**
 * A run's colour in each appearance, as the properties `planning.css` picks
 * between, so the code follows the appearance without being drawn again;
 * nothing for a run in the theme's own foreground.
 */
function runColours({ color, lightColor }: CodeToken): CSSProperties | undefined {
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

/** Lines of a file, numbered from where they sit in it, the lines `pointed` names lit: a card's, and a File tab's. */
export function CodeLineRows({
  firstLine,
  lines,
  pointed,
}: {
  firstLine: number;
  lines: PlanCode["lines"];
  pointed: CodeRef;
}): React.JSX.Element {
  return (
    <>
      {lines.map((tokens, index) => {
        const line = firstLine + index;
        return (
          <div
            // Note that a line's place in the file is its identity: the lines never reorder.
            key={line}
            className="code-line"
            data-pointed={String(isPointed(pointed, line))}
          >
            <span className="code-line-number">{line}</span>
            <code className="code-line-text">
              {tokens.map((token, at) => (
                <span key={at} style={runColours(token)}>
                  {token.text}
                </span>
              ))}
            </code>
          </div>
        );
      })}
    </>
  );
}

/** A card's lines. */
function CodeLines({ code }: { code: PlanCode }): React.JSX.Element {
  return (
    <div className="code-lines">
      <CodeLineRows firstLine={code.firstLine} lines={code.lines} pointed={code.ref} />
    </div>
  );
}

/**
 * The copy of a card's lines, as a transcript turn's copy behaves
 * (`copy-message.tsx`): the check mark stands while the pointer or the
 * keyboard stays on the button, with no clock to arm; a copy that lands
 * after the developer left shows nothing, and a clipboard that refused it
 * leaves the button as it was.
 */
function CopyLinesButton({
  lines,
  copyText,
}: {
  lines: string;
  copyText: (words: string) => Promise<void>;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  // Note that this is a ref, because a copy still out when the developer
  // leaves reads it as it settles, which no render stands between.
  const left = useRef(true);
  const leave = () => {
    left.current = true;
    setCopied(false);
  };
  const label = copied ? COPIED_LABEL : COPY_LABEL;
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="icon-button code-card-action"
        aria-label={label}
        onPointerEnter={() => {
          left.current = false;
        }}
        onPointerLeave={leave}
        onBlur={leave}
        onClick={() => {
          left.current = false;
          copyText(lines).then(
            () => {
              if (!left.current) setCopied(true);
            },
            () => undefined,
          );
        }}
      >
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}

/**
 * One snippet: its path, cut from the left so the file's own name stays in
 * sight, with the whole path in its hint; the lines pointed at; their copy;
 * the whole file opened in a tab of its own, from the path or its button;
 * Luke's note, where code shown before notes were asked for has none; and
 * the lines themselves.
 */
function CodeCardContent({
  showing,
  copyText,
  onOpenFile,
}: {
  showing: PlanCodeShowing;
  copyText: (words: string) => Promise<void>;
  onOpenFile: (ref: CodeRef) => void;
}): React.JSX.Element {
  const { code } = showing;
  const label = rangeLabel(code.ref);
  const open = () => onOpenFile(code.ref);
  return (
    <article
      className="code-card"
      aria-label={label === undefined ? code.ref.path : `${code.ref.path}, ${label}`}
    >
      <header className="code-card-header">
        <Tooltip label={code.ref.path}>
          <button
            type="button"
            className="code-card-path"
            aria-label={`Open ${code.ref.path}`}
            onClick={open}
          >
            <bdi>{code.ref.path}</bdi>
          </button>
        </Tooltip>
        {label === undefined ? null : <span className="code-card-range">{label}</span>}
        <span className="code-card-actions">
          <CopyLinesButton lines={copiedLines(code)} copyText={copyText} />
          <Tooltip label={OPEN_FILE_LABEL}>
            <button
              type="button"
              className="icon-button code-card-action"
              aria-label={OPEN_FILE_LABEL}
              onClick={open}
            >
              <FileInputIcon aria-hidden="true" />
            </button>
          </Tooltip>
        </span>
      </header>
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
 * otherwise redraw each of them several times a second. The copy it holds
 * is the window's clipboard, which is the same door from one draw to the
 * next, and so is its opening of a file, the panel's own.
 */
const CodeCard = memo(CodeCardContent, (was, now) => was.showing.callId === now.showing.callId);

/** One call's run: the checkpoint it begins at, then each code shown on it. */
function CodeFeedRun({
  call,
  now,
  copyText,
  onOpenFile,
}: {
  call: CodeFeedCall;
  now: number;
  copyText: (words: string) => Promise<void>;
  onOpenFile: (ref: CodeRef) => void;
}): React.JSX.Element {
  return (
    <>
      <Checkpoint
        trailing={
          call.live ? (
            <span className="flex items-center gap-1.5 text-developer">
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {LIVE_LABEL}
            </span>
          ) : null
        }
      >
        {callHeading(call.startedAt, now)}
      </Checkpoint>
      {call.showings.map((showing) => (
        <CodeCard
          key={showing.callId}
          showing={showing}
          copyText={copyText}
          onOpenFile={onOpenFile}
        />
      ))}
    </>
  );
}

/** The tab: every code shown on the plan, under its call, kept scrolled to the newest while the developer has not scrolled away. */
export function CodePane({
  shown,
  calls,
  copyText,
  onOpenFile,
}: {
  shown: readonly PlanCodeShowing[];
  /** The plan's calls as the Transcript tab draws them, which the code is grouped under. */
  calls: readonly CodeFeedCallSource[];
  /** Puts a card's lines on the clipboard; a refusal rejects. */
  copyText: (words: string) => Promise<void>;
  /** Opens the whole file a card's lines are of in a tab of its own, those lines lit. */
  onOpenFile: (ref: CodeRef) => void;
}): React.JSX.Element {
  const now = Date.now();
  return (
    <section className="code-pane ph-no-capture" aria-label="Code shown">
      <Conversation>
        {/* No top padding, because a sticky checkpoint would leave what scrolled under it showing in that band. */}
        <ConversationContent className="pt-0">
          {codeFeedCalls(shown, calls).map((call) => (
            <CodeFeedRun
              key={call.key}
              call={call}
              now={now}
              copyText={copyText}
              onOpenFile={onOpenFile}
            />
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </section>
  );
}
