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
} from "@sidecar/panel";
import {
  CONVERSATION_VIEW_ACTION_OUTCOME,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewMessage,
  type ConversationViewToolPart,
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
import { isRecord, isWireString, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { ConversationCopyButton } from "./conversation-copy";
import { CONVERSATION_ENTRY_SPEAKER, type ConversationEntrySpeaker } from "./conversation-panel";
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
 * working stays a level down.
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
} as const satisfies Record<string, RowVoice>;

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
}: {
  voice: RowVoice;
  words: string;
  at: number;
  copy?: boolean;
  unspoken?: boolean;
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
  at,
  onOpenChat,
}: {
  row: ToolRow;
  at?: number;
  onOpenChat?: (identity: SessionIdentity) => void;
}): React.JSX.Element {
  const Glyph = actionGlyph(row);
  const chip = chipOf(row);
  const trailingProvider =
    row.providerId !== undefined && chip?.markId !== row.providerId ? row.providerId : undefined;
  return (
    <li
      className="conversation-entry"
      data-speaker={VOICE.ACTION.speaker}
      data-action-kind={row.kind}
      data-tool-status={row.status}
    >
      <small className="visually-hidden">{VOICE.ACTION.label}</small>
      <div className="conversation-message">
        <span className="conversation-action">
          <span
            className="conversation-action-mark"
            aria-hidden="true"
            data-control={row.controlKind}
          >
            <Glyph />
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
  onOpenChat,
}: {
  rows: readonly FoldedRow[];
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
 * One message's rows: a user row is one bubble; an assistant row is its parts
 * in order, each drawn as what it is, with the turn's working set aside for
 * the fold. Which tool calls are announcements, actions, or details is the
 * view's decision, read back by call id; a call the view did not describe is
 * a detail.
 */
interface MessageRows {
  readonly rows: readonly React.JSX.Element[];
  readonly folded: readonly FoldedRow[];
}

function messageRows(
  view: ConversationViewMessage,
  roster: readonly SessionView[],
  onOpenChat: ((identity: SessionIdentity) => void) | undefined,
): MessageRows {
  const { message } = view;
  if (message.role === MESSAGE_ROLE.USER) {
    const voice = userVoice(message);
    return {
      rows: [
        <BubbleRow
          key={message.id}
          voice={voice}
          words={userWords(message)}
          at={view.createdAt}
          copy={voice === VOICE.YOU}
        />,
      ],
      folded: [],
    };
  }
  if (message.role === MESSAGE_ROLE.SYSTEM) return { rows: [], folded: [] };
  const folded: FoldedRow[] = [];
  const described = new Map<string, ConversationViewToolPart>(
    view.tools.map((tool) => [tool.toolCallId, tool]),
  );
  const rows: React.JSX.Element[] = [];
  const open = onOpenChat ? { onOpenChat } : undefined;
  message.parts.forEach((part: StoredPart, index) => {
    const key = `${message.id}:${index}`;
    if (isTextPart(part)) {
      rows.push(<BubbleRow key={key} voice={VOICE.LUKE} words={part.text} at={view.createdAt} />);
      return;
    }
    if (isReasoningPart(part)) {
      rows.push(<ReasoningRow key={key} text={part.text} />);
      return;
    }
    if (!isStoredToolPart(part)) return;
    const tool = described.get(part.toolCallId);
    switch (tool?.kind) {
      case CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE: {
        const words = announcedWords(part);
        if (words !== undefined) {
          rows.push(
            <BubbleRow
              key={key}
              voice={VOICE.LUKE}
              words={words}
              at={view.createdAt}
              unspoken={tool.unspoken}
            />,
          );
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
          rows.push(<ActionRow key={key} row={row} at={view.createdAt} {...open} />);
        }
        return;
      }
      default:
        folded.push({ kind: CONVERSATION_VIEW_TOOL_KIND.DETAIL, part });
    }
  });
  return { rows, folded };
}

/**
 * The thread as turns. Each group's messages draw in sequence, and the
 * group's working — its details and its failed actions — closes the group
 * under one fold, so a refusal is read inside the turn that tried it and
 * never as a row of its own.
 */
export function ConversationTurns({
  groups,
  roster = [],
  onOpenChat,
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
}): React.JSX.Element {
  return (
    <ol className="conversation-list">
      {groups.flatMap((group) => {
        const drawn = group.messages.map((message) => messageRows(message, roster, onOpenChat));
        const rows = drawn.flatMap((message) => message.rows);
        const folded = drawn.flatMap((message) => message.folded);
        return folded.length === 0
          ? rows
          : [
              ...rows,
              <FoldedRows
                key={`${group.turnId}:folded`}
                rows={folded}
                {...(onOpenChat ? { onOpenChat } : undefined)}
              />,
            ];
      })}
    </ol>
  );
}
