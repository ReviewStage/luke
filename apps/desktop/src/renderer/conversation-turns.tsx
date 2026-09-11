import { ACTION_KIND, type SessionActionKind } from "@sidecar/actions";
import {
  ArchiveIcon,
  ControlIcon,
  ExternalIcon,
  MessageIcon,
  PencilIcon,
  PlusIcon,
  ProviderMark,
  StopIcon,
  WingFace,
} from "@sidecar/panel";
import {
  CONVERSATION_VIEW_ACTION_OUTCOME,
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
  storedToolName,
  TOOL_PART_STATE,
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
import { ConversationRatingControl, type RateableMessage } from "./conversation-rating";
import {
  CONVERSATION_ENTRY_SPEAKER,
  type ConversationEntrySpeaker,
  ConversationThinkingRow,
  ConversationTimeBreak,
} from "./conversation-rows";
import { opensConversationTimeBreak } from "./conversation-time-break";
import { TOOL_ROW_STATUS, type ToolRow, type ToolRowChip, toolRow } from "./conversation-tool-row";
import { MarkdownMessage } from "./markdown-message";
import type { SessionView } from "./session-model";
import { ThinkingDots } from "./thinking-dots";

/**
 * The Conversation drawn from its stored shape: the turn groups the view
 * selection answers, each a run of `UIMessage` rows. A text part is a bubble
 * on its author's side; a reasoning part is Luke's thought, folded to a line
 * that opens on its summary; an announcement is Luke's briefing in his own
 * bubble, marked when nobody heard it; and an action is a row composed from
 * the call's arguments and the envelope it answered with, the session it
 * reached a chip that is the row's own press by another hand. What the view
 * classed as a detail — a read, a workspace write, a delegation — and an
 * action whose tool failed outright draw only inside the turn, folded under
 * a count, so the thread reads as what was said and done and the turn's
 * working stays a level down. A turn that carried more than one action folds
 * them under a line that counts them, open while the turn still runs and
 * closed once it has settled, a press holding whichever the reader chose;
 * a turn of one action draws the row itself. A turn the developer did not
 * open — a roster look, a hold's release, a child's end — is Luke's own
 * judgment, and everything it did leads with his face under that name and
 * never wears a reply's bubble, so what he decided for himself is never read
 * as something the developer asked. Each of Luke's messages — a reply, a
 * briefing, words on his own judgment: the assistant rows the service takes
 * a verdict on — carries the rating control on its last words, so one
 * message takes one control; the developer's own ask and the brain's note to
 * itself carry none, since the service would refuse a rating on either.
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
 * The mark an action row leads with, one per kind of thing that can be done
 * to a session, total over the kinds so a new kind does not compile until it
 * has one. Two renames share the pencil and two creations the plus: the mark
 * says what sort of thing happened, and the words say to what.
 */
const ACTION_GLYPH = {
  [ACTION_KIND.MESSAGE]: MessageIcon,
  [ACTION_KIND.CONTROL]: ControlIcon,
  [ACTION_KIND.OPEN]: ExternalIcon,
  [ACTION_KIND.CREATE_WORKSPACE]: PlusIcon,
  [ACTION_KIND.ADD_AGENT]: PlusIcon,
  [ACTION_KIND.RENAME_WORKSPACE]: PencilIcon,
  [ACTION_KIND.RENAME_SESSION]: PencilIcon,
} as const satisfies Record<SessionActionKind, () => React.JSX.Element>;

/** A control's mark follows what its adapter said it does; a plain action keeps the bolt. */
const CONTROL_GLYPH = {
  [SESSION_CONTROL_KIND.ACTION]: ControlIcon,
  [SESSION_CONTROL_KIND.ARCHIVE]: ArchiveIcon,
  [SESSION_CONTROL_KIND.STOP]: StopIcon,
} as const satisfies Record<SessionControlKind, () => React.JSX.Element>;

function actionGlyph(row: ToolRow): () => React.JSX.Element {
  return row.controlKind !== undefined ? CONTROL_GLYPH[row.controlKind] : ACTION_GLYPH[row.kind];
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
  /** The rating control, on the last words of one of Luke's messages and nowhere else. */
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
          {rating}
          {copy ? <ConversationCopyButton words={words} /> : null}
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
  /** The rating control, on the last words of the message and nowhere else. */
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
            {rating}
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
 * An action Luke carried is a row rather than a bubble: what was done, in the
 * quiet voice the dates use, led by a mark for the kind of thing it was and
 * ended on the mark of the provider it reached — unless the chip already wears
 * that provider's mark, in which case the row's trailing mark stands down
 * rather than repeat it. A refused or unknown outcome says why under the
 * words; an accepted one shows the carrier's own note where it wrote one.
 */
function ActionRow({
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
  const Glyph = actionGlyph(row);
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
      data-action-kind={row.kind}
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
            {own ? <WingFace /> : <Glyph />}
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

/** What a detail's state says of it, in one word the row draws beside the tool's name. */
const DETAIL_STATE_LABEL = {
  [TOOL_PART_STATE.INPUT_STREAMING]: PENDING_LABEL,
  [TOOL_PART_STATE.INPUT_AVAILABLE]: PENDING_LABEL,
  [TOOL_PART_STATE.OUTPUT_AVAILABLE]: "Done",
  [TOOL_PART_STATE.OUTPUT_ERROR]: "Failed",
} as const satisfies Record<StoredToolPart["state"], string>;

/** A tool's name as a reader sees it: the underscores the model spells it with become spaces. */
export function detailToolLabel(toolName: string): string {
  return toolName.replaceAll("_", " ");
}

/**
 * A call the view classed as a detail — a read, a workspace write, a
 * delegation: the turn's working, named by its tool and its state and nothing
 * of what it read or wrote, drawn only inside the turn.
 */
function DetailRow({ part }: { part: StoredToolPart }): React.JSX.Element {
  return (
    <li className="conversation-detail" data-tool-state={part.state}>
      <span className="conversation-detail-name">{detailToolLabel(storedToolName(part))}</span>
      <span className="conversation-detail-state">{DETAIL_STATE_LABEL[part.state]}</span>
      {part.state === TOOL_PART_STATE.OUTPUT_ERROR ? (
        <span className="conversation-action-reason">{part.errorText}</span>
      ) : null}
    </li>
  );
}

/** What the turn folds a level down: its details, and the actions whose tools failed outright. */
type FoldedRow =
  | { readonly kind: typeof CONVERSATION_VIEW_TOOL_KIND.DETAIL; readonly part: StoredToolPart }
  | {
      readonly kind: typeof CONVERSATION_VIEW_TOOL_KIND.ACTION;
      readonly row: ToolRow;
      readonly part: StoredToolPart;
    };

function foldedLabel(count: number): string {
  return count === 1 ? "1 detail" : `${count} details`;
}

/**
 * The turn's working, folded under a count: closed by default, opened on the
 * summary's press, and a native disclosure rather than a control of Luke's
 * own, so a reader opens and closes it with nothing else moving.
 */
function FoldedRows({
  rows,
  judgment,
  onOpenChat,
}: {
  rows: readonly FoldedRow[];
  judgment: Judgment;
  onOpenChat?: (identity: SessionIdentity) => void;
}): React.JSX.Element {
  return (
    <li
      className="conversation-entry"
      data-speaker={CONVERSATION_ENTRY_SPEAKER.EVENT}
      data-folded="true"
    >
      <div className="conversation-message">
        <details className="conversation-turn-details">
          <summary className="conversation-turn-summary">{foldedLabel(rows.length)}</summary>
          <ol className="conversation-turn-rows">
            {rows.map((folded) =>
              folded.kind === CONVERSATION_VIEW_TOOL_KIND.DETAIL ? (
                <DetailRow key={folded.part.toolCallId} part={folded.part} />
              ) : (
                <ActionRow
                  key={folded.part.toolCallId}
                  row={folded.row}
                  judgment={judgment}
                  {...(onOpenChat ? { onOpenChat } : undefined)}
                />
              ),
            )}
          </ol>
        </details>
      </div>
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

/**
 * The actions one turn carried, folded under a line that counts them. The
 * fold follows the turn: open while the turn still runs, so what it is doing
 * is watched as it happens, and closed once it has settled, so a finished
 * turn reads as one line; a press holds whichever the reader chose until the
 * turn's own state next changes. The element's toggle fires for the state the
 * turn sets as well as for a press, so a toggle is read as the reader's only
 * when it leaves the element in a state the turn did not ask for; a fold that
 * mistook the turn's word for the reader's would never close. Under Luke's
 * own judgment the line leads with his face, as each row inside it does.
 */
function ActionsFold({
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
      data-actions-fold={pending ? "running" : "settled"}
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
            {own ? (
              <span className="conversation-action-mark" aria-hidden="true">
                <WingFace />
              </span>
            ) : null}
            {`${rows.length} actions`}
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
 * One row as a message hands it to its turn: drawn already, or an action the
 * turn decides the place of — a stamped row of its own, or a row inside the
 * fold, whose line carries the stamp for all of them.
 */
type DrawnRow =
  | { readonly element: React.JSX.Element; readonly action?: undefined }
  | { readonly element?: undefined; readonly action: DrawnAction };

interface DrawnAction {
  readonly key: string;
  readonly row: ToolRow;
  readonly at: number;
}

interface MessageRows {
  readonly rows: readonly DrawnRow[];
  readonly folded: readonly FoldedRow[];
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

/** The last words of a message as drawn, kept so the rating control can be placed on them once the message is read through. */
interface LastWords {
  readonly index: number;
  readonly words: string;
  readonly redraw: (rating: React.JSX.Element | undefined) => React.JSX.Element;
}

function ratingControl(
  view: ConversationViewMessage,
  words: string,
  context: RatingContext,
): React.JSX.Element {
  const rated: RateableMessage = {
    messageId: view.message.id,
    words,
    ...(context.ask !== undefined ? { ask: context.ask } : undefined),
  };
  return (
    <ConversationRatingControl
      rated={rated}
      rating={view.rating?.rating}
      {...(context.onOfferFeedback ? { onOfferFeedback: context.onOfferFeedback } : undefined)}
    />
  );
}

/**
 * One message's rows: a user row is one bubble; an assistant row is its parts
 * in order, each drawn as what it is, with the turn's working set aside for
 * the fold, and the rating control on its last words. Which tool calls are
 * announcements, actions, or details is the view's decision, read back by
 * call id; a call the view did not describe is a detail.
 */
function messageRows(
  view: ConversationViewMessage,
  judgment: Judgment,
  roster: readonly SessionView[],
  rating: RatingContext,
): MessageRows {
  const { message } = view;
  if (message.role === MESSAGE_ROLE.USER) {
    const voice = userVoice(message);
    return {
      rows: [
        {
          element: (
            <BubbleRow
              key={message.id}
              voice={voice}
              words={userWords(message)}
              at={view.createdAt}
              copy={voice === VOICE.YOU}
            />
          ),
        },
      ],
      folded: [],
    };
  }
  if (message.role === MESSAGE_ROLE.SYSTEM) return { rows: [], folded: [] };
  const folded: FoldedRow[] = [];
  const described = new Map<string, ConversationViewToolPart>(
    view.tools.map((tool) => [tool.toolCallId, tool]),
  );
  const rows: DrawnRow[] = [];
  const draw = (element: React.JSX.Element) => rows.push({ element });
  let lastWords: LastWords | undefined;
  const drawWords = (words: string, redraw: LastWords["redraw"]) => {
    draw(redraw(undefined));
    lastWords = { index: rows.length - 1, words, redraw };
  };
  message.parts.forEach((part: StoredPart, index) => {
    const key = `${message.id}:${index}`;
    if (isTextPart(part)) {
      drawWords(part.text, (control) =>
        judgment === JUDGMENT.OWN ? (
          <OwnWordsRow key={key} words={part.text} at={view.createdAt} rating={control} />
        ) : (
          <BubbleRow
            key={key}
            voice={VOICE.LUKE}
            words={part.text}
            at={view.createdAt}
            rating={control}
          />
        ),
      );
      return;
    }
    if (isReasoningPart(part)) {
      draw(<ReasoningRow key={key} text={part.text} />);
      return;
    }
    if (!isStoredToolPart(part)) return;
    const tool = described.get(part.toolCallId);
    switch (tool?.kind) {
      case CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE: {
        const words = announcedWords(part);
        if (words !== undefined) {
          drawWords(words, (control) => (
            <BubbleRow
              key={key}
              voice={VOICE.LUKE}
              words={words}
              at={view.createdAt}
              unspoken={tool.unspoken}
              rating={control}
            />
          ));
        }
        return;
      }
      case CONVERSATION_VIEW_TOOL_KIND.ACTION: {
        const row = toolRow(part, roster);
        if (row === undefined) {
          folded.push({ kind: CONVERSATION_VIEW_TOOL_KIND.DETAIL, part });
        } else if (tool.outcome === CONVERSATION_VIEW_ACTION_OUTCOME.REFUSED) {
          folded.push({ kind: CONVERSATION_VIEW_TOOL_KIND.ACTION, row, part });
        } else {
          rows.push({ action: { key, row, at: view.createdAt } });
        }
        return;
      }
      default:
        folded.push({ kind: CONVERSATION_VIEW_TOOL_KIND.DETAIL, part });
    }
  });
  if (lastWords !== undefined) {
    const placed: LastWords = lastWords;
    rows[placed.index] = {
      element: placed.redraw(ratingControl(view, placed.words, rating)),
    };
  }
  return { rows, folded };
}

/** How many actions a turn carries before they fold under a count rather than standing as rows. */
const FOLD_FROM_ACTIONS = 2;

/**
 * One turn's rows in order, its actions placed: each a stamped row of its own
 * while there are too few to fold, or all of them inside one fold standing
 * where the first stood, unstamped, under the fold's own stamp. The rows
 * between actions keep their places around it.
 */
function turnRows(
  drawn: readonly DrawnRow[],
  pending: boolean,
  judgment: Judgment,
  turnId: string,
  onOpenChat: ((identity: SessionIdentity) => void) | undefined,
): readonly React.JSX.Element[] {
  const open = onOpenChat ? { onOpenChat } : undefined;
  const actions = drawn.flatMap((row) => (row.action ? [row.action] : []));
  const first = actions[0];
  if (first === undefined || actions.length < FOLD_FROM_ACTIONS) {
    return drawn.map((row) =>
      row.action ? (
        <ActionRow
          key={row.action.key}
          row={row.action.row}
          judgment={judgment}
          at={row.action.at}
          {...open}
        />
      ) : (
        row.element
      ),
    );
  }
  const fold = (
    <ActionsFold
      key={`${turnId}:actions`}
      rows={actions.map((action) => (
        <ActionRow key={action.key} row={action.row} judgment={judgment} {...open} />
      ))}
      pending={pending}
      judgment={judgment}
      at={first.at}
    />
  );
  return drawn.flatMap((row) =>
    row.action ? (row.action === first ? [fold] : []) : [row.element],
  );
}

/** When a turn's rows begin and end: its earliest and latest message, which is what dates the silence around it. */
function groupSpan(group: ConversationViewTurnGroup) {
  const instants = group.messages.map((message) => message.createdAt);
  return { first: Math.min(...instants), last: Math.max(...instants) };
}

/**
 * The thread as turns. Each group's messages draw in sequence, its actions
 * fold under a count once there are two, and the group's working — its
 * details and its failed actions — closes the group under one fold, so a
 * refusal is read inside the turn that tried it and never as a row of its
 * own. A turn still running ends in Luke's wait, driven by the turn row's
 * own status and nothing else. A turn that followed a long silence is dated
 * over it, and whatever the caller hands in as children — the lines still
 * being said, the developer's place, a wait no stored turn carries yet —
 * closes the list, so the thread is one list under one snap point.
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
        const drawn = group.messages.map((message) => {
          const rows = messageRows(message, judgment, roster, {
            ask,
            onOfferFeedback: onOfferRatingFeedback,
          });
          if (
            judgment === JUDGMENT.ASK &&
            message.message.role === MESSAGE_ROLE.USER &&
            message.message.metadata.author === MESSAGE_AUTHOR.DEVELOPER
          ) {
            ask = userWords(message.message);
          }
          return rows;
        });
        const rows = turnRows(
          drawn.flatMap((message) => message.rows),
          pending,
          judgment,
          group.turnId,
          onOpenChat,
        );
        const folded = drawn.flatMap((message) => message.folded);
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
          ...rows,
          ...(folded.length === 0
            ? []
            : [
                <FoldedRows
                  key={`${group.turnId}:folded`}
                  rows={folded}
                  judgment={judgment}
                  {...(onOpenChat ? { onOpenChat } : undefined)}
                />,
              ]),
          ...(pending && group.turn !== undefined
            ? [
                <ConversationThinkingRow
                  key={`${group.turnId}:thinking`}
                  since={group.turn.startedAt ?? group.turn.queuedAt}
                  now={now}
                />,
              ]
            : []),
        ];
      })}
      {children}
    </ol>
  );
}
