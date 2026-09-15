import {
  ArchiveIcon,
  BookIcon,
  ChevronIcon,
  ControlIcon,
  DisplayIcon,
  DocumentIcon,
  DownloadIcon,
  ExternalIcon,
  ListIcon,
  MegaphoneIcon,
  MessageIcon,
  OptionsIcon,
  PencilIcon,
  PlusIcon,
  ProviderMark,
  SearchIcon,
  StopIcon,
  TrashIcon,
  WingFace,
} from "@sidecar/panel";
import {
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewMessage,
  type ConversationViewToolPart,
  type ConversationViewTurn,
  type ConversationViewTurnGroup,
  isStoredToolPart,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  SESSION_CONTROL_KIND,
  type SessionControlKind,
  type SessionIdentity,
  type StoredToolPart,
} from "@sidecar/session";
import type { StoredUIMessage } from "@sidecar/session/ui-messages";
import {
  isRecord,
  isWireString,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnOrigin,
  type TurnStatus,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { useState } from "react";
import { ConversationCopyButton } from "./conversation-copy";
import { ConversationMessageMenu } from "./conversation-menu";
import { ConversationRatingControl, type RatedMessageDraft } from "./conversation-rating";
import {
  CONVERSATION_ENTRY_SPEAKER,
  type ConversationEntrySpeaker,
  ConversationThinkingRow,
  ConversationTimeBreak,
} from "./conversation-rows";
import { opensConversationTimeBreak } from "./conversation-time-break";
import {
  isActionRowKind,
  TOOL_ROW_KIND,
  TOOL_ROW_STATUS,
  type ToolRow,
  type ToolRowChip,
  type ToolRowKind,
  toolRow,
} from "./conversation-tool-row";
import { MarkdownMessage } from "./markdown-message";
import type { SessionView } from "./session-model";
import { ThinkingDots } from "./thinking-dots";

/**
 * The Conversation drawn from its stored shape: the turn groups the view
 * selection answers, each a run of `UIMessage` rows. A text part is a bubble
 * on its author's side; a reasoning part is Luke's thought, folded to a line
 * that opens on its summary; an announcement is Luke's briefing in his own
 * bubble, marked when nobody heard it, and that bubble is the whole of what
 * the announce call draws. Every other stored tool call of one assistant
 * message — reads, actions, even one whose tool failed — draws ahead of that
 * message's words, in the call order the message stored them: one call as
 * the row it is, stamped like any other, and two or more inside one fold
 * under a line that counts them, so a message that did one thing reads as
 * that thing and a message that did many reads as one line. Every call is one
 * row anatomy — a mark for the kind of thing it was, then a sentence with the
 * session it reached as a chip — whether it did something to a session or to
 * Luke, or only read a roster, a transcript, a file, or the notebook; what a
 * read answered is never drawn. A turn the developer
 * did not open — a roster look, a hold's release, a child's end — is Luke's
 * own judgment, and everything it did leads with his face under that name and
 * never wears a reply's bubble, so what he decided for himself is never read
 * as something the developer asked. Each of Luke's messages — a reply, a
 * briefing, words on his own judgment: the assistant rows the service takes a
 * verdict on — carries the rating control on its last words, behind the
 * ellipsis in that row's margin, so one message takes one control; the
 * developer's own ask and the brain's note to itself carry none, since the
 * service would refuse a rating on either.
 *
 * Everything here is drawn inside the Conversation subtree, which the session
 * recording blocks whole: a session's title on a chip, a briefing's words, a
 * refusal's reason all stay on this machine.
 */

/** What each kind of row is to a reader: who it speaks for, and the name read before it. */
interface RowVoice {
  readonly speaker: ConversationEntrySpeaker;
  readonly label: string;
}

const VOICE = {
  YOU: { speaker: CONVERSATION_ENTRY_SPEAKER.YOU, label: "You" },
  LUKE: { speaker: CONVERSATION_ENTRY_SPEAKER.LUKE, label: "Luke" },
  /** A note the brain wrote itself into the conversation, never the developer's words. */
  NOTE: { speaker: CONVERSATION_ENTRY_SPEAKER.EVENT, label: "Note" },
  ACTION: { speaker: CONVERSATION_ENTRY_SPEAKER.EVENT, label: "Action" },
  /** A turn nobody opened: what Luke did and said in it is his own judgment, and the label says so. */
  OWN: { speaker: CONVERSATION_ENTRY_SPEAKER.EVENT, label: "Luke, on his own judgment" },
} as const satisfies Record<string, RowVoice>;

/** Whose judgment a turn's rows record, stamped on each so the two never look alike. */
const JUDGMENT = { ASK: "ask", OWN: "own" } as const;

type Judgment = (typeof JUDGMENT)[keyof typeof JUDGMENT];

/** The origins the developer opened a turn by; every other origin is a wake, and the turn Luke's own. */
const DEVELOPER_ORIGINS: ReadonlySet<TurnOrigin> = new Set<TurnOrigin>([
  TURN_ORIGIN.TYPED,
  TURN_ORIGIN.SPOKEN,
]);

/** A turn with no row to say who opened it is drawn as an ask rather than claimed as Luke's own. */
export function judgmentOf(turn: ConversationViewTurn | undefined): Judgment {
  return turn !== undefined && !DEVELOPER_ORIGINS.has(turn.origin) ? JUDGMENT.OWN : JUDGMENT.ASK;
}

/** The statuses under which a turn is still going: queued for its run, or running it. */
const PENDING_STATUSES: ReadonlySet<TurnStatus> = new Set<TurnStatus>([
  TURN_STATUS.QUEUED,
  TURN_STATUS.RUNNING,
]);

export function turnPending(turn: ConversationViewTurn | undefined): boolean {
  return turn !== undefined && PENDING_STATUSES.has(turn.status);
}

/**
 * The mark a tool call's row leads with, one per kind of thing a call can be,
 * total over the kinds so a new kind does not compile until it has one. Two
 * renames share the pencil, two creations and a delegation the plus, every
 * read of a text the page, every look at a list the lines: the mark says what
 * sort of thing happened, and the words say to what. A call to a tool this
 * build has no words for leaves the mark's room empty rather than borrowing
 * one that would say something untrue of it.
 */
const ROW_GLYPH = {
  [TOOL_ROW_KIND.MESSAGE]: MessageIcon,
  [TOOL_ROW_KIND.CONTROL]: ControlIcon,
  [TOOL_ROW_KIND.OPEN]: ExternalIcon,
  [TOOL_ROW_KIND.CREATE_WORKSPACE]: PlusIcon,
  [TOOL_ROW_KIND.ADD_AGENT]: PlusIcon,
  [TOOL_ROW_KIND.RENAME_WORKSPACE]: PencilIcon,
  [TOOL_ROW_KIND.RENAME_SESSION]: PencilIcon,
  [TOOL_ROW_KIND.SETTING]: OptionsIcon,
  [TOOL_ROW_KIND.PANEL]: DisplayIcon,
  [TOOL_ROW_KIND.FEEDBACK]: MegaphoneIcon,
  [TOOL_ROW_KIND.UPDATE]: DownloadIcon,
  [TOOL_ROW_KIND.REMEMBER]: BookIcon,
  [TOOL_ROW_KIND.FORGET]: TrashIcon,
  [TOOL_ROW_KIND.ROSTER]: ListIcon,
  [TOOL_ROW_KIND.TRANSCRIPT]: DocumentIcon,
  [TOOL_ROW_KIND.WORKSPACE_READ]: DocumentIcon,
  [TOOL_ROW_KIND.WORKSPACE_WRITE]: PencilIcon,
  [TOOL_ROW_KIND.DAILY_NOTE_APPEND]: PencilIcon,
  [TOOL_ROW_KIND.DAILY_NOTES_LIST]: ListIcon,
  [TOOL_ROW_KIND.SKILL]: DocumentIcon,
  [TOOL_ROW_KIND.DELEGATE]: PlusIcon,
  [TOOL_ROW_KIND.CHILDREN]: ListIcon,
  [TOOL_ROW_KIND.CONVERSATIONS]: ListIcon,
  [TOOL_ROW_KIND.CHILD_HISTORY]: DocumentIcon,
  [TOOL_ROW_KIND.NOTEBOOK_SEARCH]: SearchIcon,
  [TOOL_ROW_KIND.NOTEBOOK_READ]: BookIcon,
  [TOOL_ROW_KIND.OTHER]: undefined,
} as const satisfies Record<ToolRowKind, (() => React.JSX.Element) | undefined>;

/** A control's mark follows what its adapter said it does; a plain action keeps the bolt. */
const CONTROL_GLYPH = {
  [SESSION_CONTROL_KIND.ACTION]: ControlIcon,
  [SESSION_CONTROL_KIND.ARCHIVE]: ArchiveIcon,
  [SESSION_CONTROL_KIND.STOP]: StopIcon,
} as const satisfies Record<SessionControlKind, () => React.JSX.Element>;

function rowGlyph(row: ToolRow): (() => React.JSX.Element) | undefined {
  return row.controlKind !== undefined ? CONTROL_GLYPH[row.controlKind] : ROW_GLYPH[row.kind];
}

/** What a reader is told of an announcement no device claimed before its offer lapsed. */
const UNSPOKEN_LABEL = "Not spoken";

/** What a reader is told of an action still under way. */
const PENDING_LABEL = "Under way";

const ROW_TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function RowStamp({ at }: { at: number }): React.JSX.Element {
  const instant = new Date(at);
  return (
    <time className="conversation-time" dateTime={instant.toISOString()}>
      {ROW_TIME.format(instant)}
    </time>
  );
}

function BubbleRow({
  voice,
  words,
  at,
  copy = true,
  unspoken = false,
  rating,
}: {
  voice: RowVoice;
  words: string;
  at: number;
  copy?: boolean;
  unspoken?: boolean;
  /** The rating control, behind the ellipsis on the last words of one of Luke's messages and nowhere else. */
  rating?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li
      className="conversation-entry"
      data-speaker={voice.speaker}
      data-unspoken={unspoken ? "true" : undefined}
    >
      <small className="visually-hidden">{voice.label}</small>
      <div className="conversation-message">
        <span className="conversation-bubble">
          <MarkdownMessage words={words} className="conversation-words" />
          {unspoken ? <span className="conversation-unspoken">{UNSPOKEN_LABEL}</span> : null}
          {copy ? <ConversationCopyButton words={words} /> : null}
          {rating === undefined ? null : (
            <ConversationMessageMenu>{rating}</ConversationMessageMenu>
          )}
        </span>
      </div>
      <RowStamp at={at} />
    </li>
  );
}

/** Luke's thought before what followed it, folded to a line that opens on its words; never a control of anything. */
function ReasoningRow({ text }: { text: string }): React.JSX.Element {
  return (
    <li
      className="conversation-entry"
      data-speaker={CONVERSATION_ENTRY_SPEAKER.LUKE}
      data-reasoning="true"
    >
      <small className="visually-hidden">{VOICE.LUKE.label}</small>
      <div className="conversation-message">
        <details className="conversation-reasoning">
          <summary className="conversation-reasoning-summary">Thought</summary>
          <span className="conversation-reasoning-words">{text}</span>
        </details>
      </div>
    </li>
  );
}

/**
 * Words Luke wrote in a turn nobody opened: his own judgment, drawn in the
 * quiet voice under his face and never as a reply's bubble, because a bubble
 * would read as an answer to something the developer said.
 */
function OwnWordsRow({
  words,
  at,
  rating,
}: {
  words: string;
  at: number;
  /** The rating control, behind the ellipsis on the last words of the message and nowhere else. */
  rating?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li
      className="conversation-entry"
      data-speaker={VOICE.OWN.speaker}
      data-judgment={JUDGMENT.OWN}
      data-own-words="true"
    >
      <small className="visually-hidden">{VOICE.OWN.label}</small>
      <div className="conversation-message">
        <span className="conversation-action">
          <span className="conversation-action-mark" aria-hidden="true">
            <WingFace />
          </span>
          <span className="conversation-action-body">
            <MarkdownMessage words={words} className="conversation-words" />
            {rating === undefined ? null : (
              <ConversationMessageMenu>{rating}</ConversationMessageMenu>
            )}
          </span>
        </span>
      </div>
      <RowStamp at={at} />
    </li>
  );
}

/**
 * The chip naming the session an action reached. Where the session has an
 * identity to open by and its row would open, the chip is that row's own press
 * by another hand: it mints the same open act, for the identity the record
 * names, and the host answers with the address the provider reported — or
 * refuses, for a session that reported none. Every other chip is a name.
 */
function SessionChip({
  chip,
  onOpenChat,
}: {
  chip: ToolRowChip;
  onOpenChat?: (identity: SessionIdentity) => void;
}): React.JSX.Element {
  const face = (
    <>
      {chip.markId === undefined ? null : (
        <ProviderMark providerId={chip.markId} className="conversation-chip-mark" />
      )}
      {chip.text}
    </>
  );
  const identity = chip.identity;
  return identity !== undefined && chip.openable && onOpenChat !== undefined ? (
    <button
      type="button"
      className="conversation-action-chip"
      aria-label={`Open ${chip.text}`}
      onClick={() => onOpenChat(identity)}
    >
      {face}
    </button>
  ) : (
    <span className="conversation-action-chip">{face}</span>
  );
}

/** A row's runs are one chip at most and text runs that never repeat, so each names itself. */
const RUN_KEY = { CHIP: "chip" } as const;

function chipOf(row: ToolRow): ToolRowChip | undefined {
  for (const run of row.runs) if ("chip" in run) return run.chip;
  return undefined;
}

/**
 * A tool call Luke made is a row rather than a bubble: what was done or read,
 * in the quiet voice the dates use, led by a mark for the kind of thing it
 * was and ended on the mark of the provider it reached — unless the chip
 * already wears that provider's mark, in which case the row's trailing mark
 * stands down rather than repeat it. A refused or unknown outcome says why
 * under the words; an accepted action shows the carrier's own note where it
 * wrote one. A row of its own carries the message's stamp; one inside a fold
 * carries none, since the fold's line carries it for all of them.
 */
function ToolCallRow({
  row,
  judgment,
  at,
  onOpenChat,
}: {
  row: ToolRow;
  judgment: Judgment;
  at?: number;
  onOpenChat?: (identity: SessionIdentity) => void;
}): React.JSX.Element {
  const Glyph = rowGlyph(row);
  const chip = chipOf(row);
  const trailingProvider =
    row.providerId !== undefined && chip?.markId !== row.providerId ? row.providerId : undefined;
  const own = judgment === JUDGMENT.OWN;
  const voice = own ? VOICE.OWN : VOICE.ACTION;
  return (
    <li
      className="conversation-entry"
      data-speaker={voice.speaker}
      data-judgment={judgment}
      data-tool-kind={row.kind}
      data-action-kind={isActionRowKind(row.kind) ? row.kind : undefined}
      data-tool-status={row.status}
    >
      <small className="visually-hidden">{voice.label}</small>
      <div className="conversation-message">
        <span className="conversation-action">
          <span
            className="conversation-action-mark"
            aria-hidden="true"
            data-control={own ? undefined : row.controlKind}
          >
            {own ? <WingFace /> : Glyph === undefined ? null : <Glyph />}
          </span>
          <span className="conversation-action-body">
            <span className="conversation-words">
              {row.runs.map((run) =>
                "chip" in run ? (
                  <SessionChip
                    key={RUN_KEY.CHIP}
                    chip={run.chip}
                    {...(onOpenChat ? { onOpenChat } : undefined)}
                  />
                ) : (
                  <span key={run.text}>{run.text}</span>
                ),
              )}
              {row.status === TOOL_ROW_STATUS.PENDING ? (
                <span className="conversation-action-pending">
                  <ThinkingDots />
                  <span className="visually-hidden">{PENDING_LABEL}</span>
                </span>
              ) : null}
            </span>
            {row.reason !== undefined ? (
              <span className="conversation-action-reason">{row.reason}</span>
            ) : null}
            {row.note !== undefined ? (
              <span className="conversation-action-note">{row.note}</span>
            ) : null}
            {row.warning !== undefined ? (
              <span className="conversation-action-reason">{row.warning}</span>
            ) : null}
          </span>
          {trailingProvider === undefined ? null : (
            <span className="conversation-action-provider" aria-hidden="true">
              <ProviderMark providerId={trailingProvider} />
            </span>
          )}
        </span>
      </div>
      {at === undefined ? null : <RowStamp at={at} />}
    </li>
  );
}

/** The reader's press on a fold, remembered with the turn state it was made under. */
export interface FoldChoice {
  readonly pending: boolean;
  readonly open: boolean;
}

/**
 * Whether a fold stands open: as the turn's state has it — open while the
 * turn still runs, closed once settled — unless the reader pressed it under
 * that same state, in which case their press holds. A press made while the
 * turn ran does not outlive the turn's settling: the turn's own change is the
 * later word, and the fold follows it.
 */
export function foldOpen(choice: FoldChoice | undefined, pending: boolean): boolean {
  return choice !== undefined && choice.pending === pending ? choice.open : pending;
}

/** How many tool calls a message carries before they fold under a count rather than standing as rows. */
const FOLD_FROM_CALLS = 2;

/**
 * The tool calls one assistant message carried, folded under a line that
 * counts them, led by the disclosure chevron the settings rows use, which
 * turns to point down while the fold stands open. The line lifts under the
 * pointer the way a settings row does, its ground reaching a step past the
 * chevron's edge rather than pushing the chevron off it, so the chevron and
 * the marks of the rows it folds stand in one column whether the fold is
 * open or closed. The fold follows the turn: open while the turn still runs, so
 * what it is doing is watched as it happens, and closed once it has settled,
 * so a finished message reads as one line; a press holds whichever the reader
 * chose until the turn's own state next changes. The element's toggle fires
 * for the state the turn set as well as for a press, so a toggle is read as
 * the reader's only when it leaves the element in a state the turn did not
 * ask for; a fold that mistook the turn's word for the reader's would never
 * close. Under Luke's own judgment the line leads with his face, as each row
 * inside it does.
 */
function ToolCallsFold({
  rows,
  pending,
  judgment,
  at,
}: {
  rows: readonly React.JSX.Element[];
  pending: boolean;
  judgment: Judgment;
  /** When the first of the folded actions ran: the line's stamp, since the rows inside carry none. */
  at: number;
}): React.JSX.Element {
  const [choice, setChoice] = useState<FoldChoice | undefined>(undefined);
  const open = foldOpen(choice, pending);
  const own = judgment === JUDGMENT.OWN;
  const voice = own ? VOICE.OWN : VOICE.ACTION;
  return (
    <li
      className="conversation-entry"
      data-speaker={voice.speaker}
      data-judgment={judgment}
      data-tool-calls-fold={pending ? "running" : "settled"}
    >
      <small className="visually-hidden">{voice.label}</small>
      <div className="conversation-message">
        <details
          className="conversation-actions-fold"
          open={open}
          onToggle={(event) => {
            // The browser fires this for the state the turn set as well as for a
            // press; only a state the prop does not already hold is the reader's.
            if (event.currentTarget.open !== open) {
              setChoice({ pending, open: event.currentTarget.open });
            }
          }}
        >
          <summary className="conversation-turn-summary">
            <ChevronIcon />
            {own ? (
              <span className="conversation-action-mark" aria-hidden="true">
                <WingFace />
              </span>
            ) : null}
            <span>{`${rows.length} tool calls`}</span>
          </summary>
          <ol className="conversation-turn-rows">{rows}</ol>
        </details>
      </div>
      <RowStamp at={at} />
    </li>
  );
}

type StoredPart = StoredUIMessage["parts"][number];

/**
 * The two part types drawn as words, as the SDK spells them. Restated here
 * against the SDK's own type rather than imported at run time, because the
 * session barrel reaches the SDK for its types alone and this bundle keeps it
 * that way.
 */
const UI_PART_TYPE = {
  TEXT: "text",
  REASONING: "reasoning",
} as const satisfies Record<string, StoredPart["type"]>;

type TextPart = Extract<StoredPart, { type: typeof UI_PART_TYPE.TEXT }>;
type ReasoningPart = Extract<StoredPart, { type: typeof UI_PART_TYPE.REASONING }>;

function isTextPart(part: StoredPart): part is TextPart {
  return part.type === UI_PART_TYPE.TEXT;
}

function isReasoningPart(part: StoredPart): part is ReasoningPart {
  return part.type === UI_PART_TYPE.REASONING;
}

/** The words an announce call carries: its one `briefing` argument, or nothing for a call spelled otherwise. */
export function announcedWords(part: StoredToolPart): string | undefined {
  // SAFETY: a stored part's input is the call's JSON arguments; the wire boundary is where they are read.
  const input = unparsedWire(part.input as WireBoundaryInput);
  return isRecord(input) && isWireString(input.briefing) ? input.briefing : undefined;
}

/** The text a user row says, every text part joined as paragraphs. */
function userWords(message: StoredUIMessage): string {
  return message.parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join("\n\n");
}

function userVoice(
  message: Extract<StoredUIMessage, { role: typeof MESSAGE_ROLE.USER }>,
): RowVoice {
  return message.metadata.author === MESSAGE_AUTHOR.DEVELOPER ? VOICE.YOU : VOICE.NOTE;
}

/**
 * What the rating control on a message is handed beside the message itself:
 * the developer's ask the turn answered, where the turn had one, for the
 * draft a thumbs down offers, and the composer that offer opens.
 */
interface RatingContext {
  readonly ask?: string | undefined;
  readonly onOfferFeedback?: ((draft: string) => void) | undefined;
}

/** Whether a part draws Luke's words: a text part, or an announce call carrying its briefing. */
function drawsWords(
  part: StoredPart,
  described: ReadonlyMap<string, ConversationViewToolPart>,
): boolean {
  if (isTextPart(part)) return true;
  return (
    isStoredToolPart(part) &&
    described.get(part.toolCallId)?.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE &&
    announcedWords(part) !== undefined
  );
}

/** What the rating's draft quotes of a message: its text parts whole, or the briefing of a message that has none. */
function quotedWords(message: StoredUIMessage, lastWords: StoredPart | undefined): string {
  const text = userWords(message);
  if (text.length > 0 || lastWords === undefined || !isStoredToolPart(lastWords)) return text;
  return announcedWords(lastWords) ?? "";
}

function ratingControl(
  view: ConversationViewMessage,
  words: string,
  context: RatingContext,
): React.JSX.Element {
  const rated: RatedMessageDraft = {
    messageId: view.message.id,
    words,
    ...(context.ask !== undefined && context.ask.length > 0 ? { ask: context.ask } : undefined),
  };
  return (
    <ConversationRatingControl
      rated={rated}
      rating={view.rating?.rating}
      {...(context.onOfferFeedback ? { onOfferFeedback: context.onOfferFeedback } : undefined)}
    />
  );
}

/** One tool call as a message hands it on: the row it composes to, under the key its part stands at. */
interface ToolCall {
  readonly key: string;
  readonly row: ToolRow;
}

function toolCallRow(
  call: ToolCall,
  judgment: Judgment,
  at: number | undefined,
  onOpenChat: ((identity: SessionIdentity) => void) | undefined,
): React.JSX.Element {
  return (
    <ToolCallRow
      key={call.key}
      row={call.row}
      judgment={judgment}
      {...(at === undefined ? undefined : { at })}
      {...(onOpenChat ? { onOpenChat } : undefined)}
    />
  );
}

/**
 * One message's rows: a user row is one bubble; an assistant row is its tool
 * calls ahead of the words those calls produced — one as the row it is, two or
 * more inside one fold — then its visible parts in order, with the rating
 * control on its last words. Which tool calls are announcements is the view's
 * decision, read back by call id; an announce call carrying its briefing is
 * drawn as that bubble and as no tool call row, and every other call is a row
 * composed from its own part.
 */
function messageRows(
  view: ConversationViewMessage,
  judgment: Judgment,
  pending: boolean,
  roster: readonly SessionView[],
  rating: RatingContext,
  onOpenChat?: (identity: SessionIdentity) => void,
): readonly React.JSX.Element[] {
  const { message } = view;
  if (message.role === MESSAGE_ROLE.USER) {
    const voice = userVoice(message);
    return [
      <BubbleRow
        key={message.id}
        voice={voice}
        words={userWords(message)}
        at={view.createdAt}
        copy={voice === VOICE.YOU}
      />,
    ];
  }
  if (message.role === MESSAGE_ROLE.SYSTEM) return [];
  const described = new Map<string, ConversationViewToolPart>(
    view.tools.map((tool) => [tool.toolCallId, tool]),
  );
  const rows: React.JSX.Element[] = [];
  const toolCalls: ToolCall[] = [];
  // The control stands on the message's last words, so one message takes one.
  const lastWordsAt = message.parts.findLastIndex((part: StoredPart) =>
    drawsWords(part, described),
  );
  const control =
    lastWordsAt === -1
      ? undefined
      : ratingControl(view, quotedWords(message, message.parts[lastWordsAt]), rating);
  message.parts.forEach((part: StoredPart, index) => {
    const key = `${message.id}:${index}`;
    const placed = index === lastWordsAt ? control : undefined;
    if (isTextPart(part)) {
      rows.push(
        judgment === JUDGMENT.OWN ? (
          <OwnWordsRow key={key} words={part.text} at={view.createdAt} rating={placed} />
        ) : (
          <BubbleRow
            key={key}
            voice={VOICE.LUKE}
            words={part.text}
            at={view.createdAt}
            rating={placed}
          />
        ),
      );
      return;
    }
    if (isReasoningPart(part)) {
      rows.push(<ReasoningRow key={key} text={part.text} />);
      return;
    }
    if (!isStoredToolPart(part)) return;
    const tool = described.get(part.toolCallId);
    if (tool?.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE) {
      const words = announcedWords(part);
      if (words !== undefined) {
        rows.push(
          <BubbleRow
            key={key}
            voice={VOICE.LUKE}
            words={words}
            at={view.createdAt}
            unspoken={tool.unspoken}
            rating={placed}
          />,
        );
        return;
      }
    }
    toolCalls.push({ key: `${key}:tool`, row: toolRow(part, roster) });
  });
  const [only] = toolCalls;
  if (only === undefined) return rows;
  if (toolCalls.length < FOLD_FROM_CALLS) {
    return [toolCallRow(only, judgment, view.createdAt, onOpenChat), ...rows];
  }
  return [
    <ToolCallsFold
      key={`${message.id}:tools`}
      rows={toolCalls.map((call) => toolCallRow(call, judgment, undefined, onOpenChat))}
      pending={pending}
      judgment={judgment}
      at={view.createdAt}
    />,
    ...rows,
  ];
}

/** When a turn's rows begin and end: its earliest and latest message, which is what dates the silence around it. */
function groupSpan(group: ConversationViewTurnGroup) {
  const instants = group.messages.map((message) => message.createdAt);
  return { first: Math.min(...instants), last: Math.max(...instants) };
}

/**
 * The thread as turns. Each group's messages draw in sequence, and every
 * assistant message that carried tool calls opens with them — one as a row,
 * more as one fold — before the words that followed. A turn still running ends in Luke's wait,
 * driven by the turn row's own status and nothing else. A turn that followed
 * a long silence is dated over it, and whatever the caller hands in as
 * children — the lines still being said, the developer's place, a wait no
 * stored turn carries yet — closes the list, so the thread is one list under
 * one snap point.
 */
export function ConversationTurns({
  groups,
  roster = [],
  onOpenChat,
  onOfferRatingFeedback,
  now,
  children,
}: {
  groups: readonly ConversationViewTurnGroup[];
  /**
   * The sessions as the roster holds them now, so a chip names a session by
   * its current title while the roster still holds it and offers its press
   * exactly when its own row would; a session the roster has let go is named
   * from the envelope's snapshot instead.
   */
  roster?: readonly SessionView[];
  /** The row's own press by identity; absent where nothing can open a session, and every chip is a name. */
  onOpenChat?: (identity: SessionIdentity) => void;
  /** Opens the feedback composer on the draft a thumbs down offers; absent where no composer can be offered. */
  onOfferRatingFeedback?: (draft: string) => void;
  /** The instant a running turn's wait is read against; passed down because only the app knows which clock is honest. */
  now: number;
  /** Rows drawn after the last turn, inside the same list. */
  children?: React.ReactNode;
}): React.JSX.Element {
  let previousAt: number | undefined;
  // The wait is the thread's last object or nothing: a turn still running is
  // the newest one, since eve runs a conversation's turns one at a time and
  // in order, so a pending row above a settled reply is a record eve never
  // finished writing (an interrupted run), not a run still going. Drawing a
  // wait there would tell the developer Luke is thinking about words he
  // already answered, or never will.
  const last = groups.at(-1);
  const waiting = turnPending(last?.turn) ? last?.turn : undefined;
  return (
    <ol className="conversation-list">
      {groups.flatMap((group) => {
        const span = groupSpan(group);
        const dated = opensConversationTimeBreak(previousAt, span.first);
        previousAt = span.last;
        const judgment = judgmentOf(group.turn);
        const pending = turnPending(group.turn);
        // The ask a rated reply answered is the developer's latest words in
        // the same turn before it; a turn Luke opened himself answered none.
        let ask: string | undefined;
        const drawn = group.messages.flatMap((message) => {
          const rows = messageRows(
            message,
            judgment,
            pending,
            roster,
            {
              ask,
              onOfferFeedback: onOfferRatingFeedback,
            },
            onOpenChat,
          );
          if (
            judgment === JUDGMENT.ASK &&
            message.message.role === MESSAGE_ROLE.USER &&
            message.message.metadata.author === MESSAGE_AUTHOR.DEVELOPER
          ) {
            ask = userWords(message.message);
          }
          return rows;
        });
        return [
          ...(dated
            ? [
                <ConversationTimeBreak
                  key={`${group.turnId}:break`}
                  recordedAt={span.first}
                  now={now}
                />,
              ]
            : []),
          ...drawn,
        ];
      })}
      {waiting !== undefined && last !== undefined ? (
        <ConversationThinkingRow
          key={`${last.turnId}:thinking`}
          since={waiting.startedAt ?? waiting.queuedAt}
          now={now}
        />
      ) : null}
      {children}
    </ol>
  );
}
