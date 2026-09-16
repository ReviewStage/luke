import {
  BRAIN_INPUT_MARKER,
  CHILD_COMPLETION_FIELD,
  ENVELOPE_SEPARATOR,
  OBSERVED_MESSAGES_CUT,
} from "@sidecar/brain/input-items";
import type { ChildRead } from "@sidecar/hosted/reads-wire";
import {
  ArchiveIcon,
  BookIcon,
  BrainIcon,
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
  WingFace,
} from "@sidecar/panel";
import {
  CONVERSATION_ENTRY_KIND,
  CONVERSATION_VIEW_SOURCE,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  type ConversationViewMessage,
  type ConversationViewSource,
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
  OBSERVATION_SOURCE,
  recordFromJsonLine,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnOrigin,
  type TurnStatus,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Result, Schema } from "effect";
import { useState } from "react";
import { agentSession, agentTitle, subagentTitle } from "./agent-title";
import { ConversationCopyButton } from "./conversation-copy";
import type { PlacedLiveEntry } from "./conversation-live-lines";
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
 * did not open — a roster look, a child's end — is Luke's
 * own judgment, and everything it did leads with his face under that name and
 * never wears a reply's bubble, so what he decided for himself is never read
 * as something the developer asked. A turn of an observed session's own
 * conversation — a per-workspace agent's — opens on one chip naming that
 * session, a header line of the group and no part of any bubble, so what he
 * did there is never read as done in the main thread. Each of Luke's messages — a reply, a
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
  /** The header line naming the observed session a turn group belongs to. */
  SOURCE: { speaker: CONVERSATION_ENTRY_SPEAKER.EVENT, label: "In session" },
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
function judgmentOf(turn: ConversationViewTurn | undefined): Judgment {
  return turn !== undefined && !DEVELOPER_ORIGINS.has(turn.origin) ? JUDGMENT.OWN : JUDGMENT.ASK;
}

/** The statuses under which a turn is still going: queued for its run, or running it. */
const PENDING_STATUSES: ReadonlySet<TurnStatus> = new Set<TurnStatus>([
  TURN_STATUS.QUEUED,
  TURN_STATUS.RUNNING,
]);

function turnPending(turn: ConversationViewTurn | undefined): boolean {
  return turn !== undefined && PENDING_STATUSES.has(turn.status);
}

/**
 * Whether the turn's answer was Luke's voice's to say: a turn the developer
 * opened by speaking hands what the brain wrote to the voice, which says it
 * in words of its own that the record keeps as his rows. The brain's own
 * words in such a turn are his thinking rather than anything said, whatever
 * the voice made of them, and are drawn folded as his written working — never
 * as a bubble the reader would take for a second answer.
 */
function answeredAloud(turn: ConversationViewTurn | undefined): boolean {
  return turn?.origin === TURN_ORIGIN.SPOKEN;
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
  reading = false,
  rating,
}: {
  voice: RowVoice;
  words: string;
  at: number;
  copy?: boolean;
  unspoken?: boolean;
  /** Whether the words are what Luke's voice said of a message folded above them. */
  reading?: boolean;
  /** The rating control, behind the ellipsis on the last words of one of Luke's messages and nowhere else. */
  rating?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li
      className="conversation-entry"
      data-speaker={voice.speaker}
      data-unspoken={unspoken ? "true" : undefined}
      data-reading={reading ? "true" : undefined}
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

/** What a fold of Luke's thinking opens on: one word for both kinds, for now. */
const THINKING_LABEL = "Thinking";

/**
 * A fold of Luke's thinking: a line drawn the way a fold of tool calls is —
 * the disclosure chevron, then his brain for a mark, then the one word — that
 * opens on the words below it, closed until the reader presses it, and never
 * a control of anything. It is a row of its own and never a row inside the
 * tool calls' fold: what he did and what he thought are two things. The two
 * rows below share it and nothing else, so the record's two kinds of
 * thinking stay two kinds in the markup while reading as one on the surface.
 */
function ThinkingFold({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <details className="conversation-thinking-fold">
      <summary className="conversation-turn-summary">
        <ChevronIcon />
        <span className="conversation-action-mark" aria-hidden="true">
          <BrainIcon />
        </span>
        <span>{THINKING_LABEL}</span>
      </summary>
      {children}
    </details>
  );
}

/** The model's own reasoning before what followed it, as the reasoning part carries it. */
function ReasoningRow({ text }: { text: string }): React.JSX.Element {
  return (
    <li
      className="conversation-entry"
      data-speaker={CONVERSATION_ENTRY_SPEAKER.LUKE}
      data-thinking-fold="true"
      data-reasoning="true"
    >
      <small className="visually-hidden">{VOICE.LUKE.label}</small>
      <div className="conversation-message">
        <ThinkingFold>
          <MarkdownMessage words={text} className="conversation-thinking-fold-words" />
        </ThinkingFold>
      </div>
    </li>
  );
}

/**
 * The brain's written words where his voice said something of them: the text
 * it handed the voice in a turn the developer opened by speaking, or a
 * briefing a device read aloud. What he actually said stands as the voice's
 * own bubble, and what the brain wrote was his working toward that, folded
 * like his reasoning but a row of its own, since the store keeps the two
 * apart and so does this.
 */
function WrittenRow({ words }: { words: string }): React.JSX.Element {
  return (
    <li
      className="conversation-entry"
      data-speaker={CONVERSATION_ENTRY_SPEAKER.LUKE}
      data-thinking-fold="true"
      data-written="true"
    >
      <small className="visually-hidden">{VOICE.LUKE.label}</small>
      <div className="conversation-message">
        <ThinkingFold>
          <MarkdownMessage words={words} className="conversation-thinking-fold-words" />
        </ThinkingFold>
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
  lead,
  rating,
}: {
  words: string;
  at: number;
  /** What stands before the words: the chip naming the child whose completion the turn answered. */
  lead?: React.ReactNode;
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
            {lead}
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

/** The action chip's own class, and the one a group's source chip adds to stand on its own line. */
const CHIP_CLASS = "conversation-action-chip";
const SOURCE_CHIP_CLASS = `${CHIP_CLASS} conversation-source-chip`;

/**
 * The chip naming the session an action reached. Where the session has an
 * identity to open by and its row would open, the chip is that row's own press
 * by another hand: it mints the same open act, for the identity the record
 * names, and the host answers with the address the provider reported — or
 * refuses, for a session that reported none. Every other chip is a name.
 */
export function SessionChip({
  chip,
  onOpenChat,
  className = CHIP_CLASS,
}: {
  chip: ToolRowChip;
  onOpenChat?: (identity: SessionIdentity) => void;
  /** The chip's classes, for a chip that stands somewhere other than in a sentence. */
  className?: string;
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
      className={className}
      aria-label={`Open ${chip.text}`}
      onClick={() => onOpenChat(identity)}
    >
      {face}
    </button>
  ) : (
    <span className={className}>{face}</span>
  );
}

/**
 * The header line of a turn group from an observed session's own
 * conversation: one chip naming the session, worn by the group rather than
 * by any of its rows, so a reader knows whose work the rows below record. The
 * chip is the action rows' session chip on the same terms: named by the
 * roster while it holds the session and pressed exactly when its own row
 * would be, and a name alone once the roster has let the session go, since
 * there is then nothing to open. Main's own groups wear none.
 */
function SourceRow({
  source,
  roster,
  onOpenChat,
}: {
  source: Extract<ConversationViewSource, { kind: typeof CONVERSATION_VIEW_SOURCE.OBSERVED }>;
  roster: readonly SessionView[];
  onOpenChat?: (identity: SessionIdentity) => void;
}): React.JSX.Element {
  const session = agentSession(source.session, roster);
  const chip: ToolRowChip = {
    text: agentTitle(source.session, roster),
    markId: session?.agentId ?? source.session.providerId,
    identity: source.session,
    openable: session?.openable ?? false,
  };
  return (
    <li
      className="conversation-entry"
      data-speaker={VOICE.SOURCE.speaker}
      data-source-session="true"
    >
      <small className="visually-hidden">{VOICE.SOURCE.label}</small>
      <div className="conversation-message">
        <SessionChip
          chip={chip}
          className={SOURCE_CHIP_CLASS}
          {...(onOpenChat ? { onOpenChat } : undefined)}
        />
      </div>
    </li>
  );
}

/** What the chip on a completion calls the child: the list's own title for it, or the bare word for a child the list no longer names. */
const SUBAGENT_CHIP_LABEL = "Sub-agent";

/**
 * The chip naming the sub-agent whose completion a turn answered, styled as
 * an action row's session chip and pressed the way the list's row is: the
 * press opens the child's transcript by the same act. A thread with nothing
 * to hand a press to draws the chip as a name, and so does a child the list
 * no longer holds, since the app closes a transcript of a child the list
 * does not name the moment it opens.
 */
function SubagentChip({
  childId,
  subagents,
  onOpenChild,
}: {
  childId: string;
  subagents: readonly ChildRead[];
  onOpenChild?: (childId: string) => void;
}): React.JSX.Element {
  const child = subagents.find((row) => row.id === childId);
  const text =
    child === undefined ? SUBAGENT_CHIP_LABEL : `${SUBAGENT_CHIP_LABEL}: ${subagentTitle(child)}`;
  return onOpenChild === undefined || child === undefined ? (
    <span className="conversation-action-chip conversation-subagent-chip">{text}</span>
  ) : (
    <button
      type="button"
      className="conversation-action-chip conversation-subagent-chip"
      aria-label={`Open ${text}`}
      onClick={() => onOpenChild(childId)}
    >
      {text}
    </button>
  );
}

/**
 * The child a completion turn answered, read from the turn's opening note:
 * the brain writes a child's end as its marker, an instant, and the
 * completion as JSON on the next line, and the row's metadata names the
 * source but not the child, so the id is read from the data the brain
 * composed. Nothing for any other turn, or for a note the reader cannot hold
 * to that shape.
 */
function completedChildOf(group: ConversationViewTurnGroup): string | undefined {
  if (group.turn?.origin !== TURN_ORIGIN.CHILD_COMPLETION) return undefined;
  for (const { message } of group.messages) {
    if (message.role !== MESSAGE_ROLE.USER) continue;
    if (message.metadata.author !== MESSAGE_AUTHOR.BRAIN) continue;
    if (message.metadata.source !== OBSERVATION_SOURCE.CHILD_COMPLETION) continue;
    const text = userWords(message);
    if (!text.startsWith(BRAIN_INPUT_MARKER.CHILD_COMPLETION)) continue;
    const data = recordFromJsonLine(text.slice(text.indexOf("\n") + 1));
    const childId = data?.[CHILD_COMPLETION_FIELD.CHILD_ID];
    if (isWireString(childId)) return childId;
  }
  return undefined;
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
interface FoldChoice {
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
function announcedWords(part: StoredToolPart): string | undefined {
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
 * An observed-messages note as the renderer reads it. The brain writes the
 * turn as its marker and an instant, then the envelope naming the chat —
 * provider, workspace where the roster had one, title (or `chat <id>`, which
 * the brain composes itself), and the instant its transcript last changed,
 * between brackets and parted by one separator — then the cut line where the
 * front was dropped, then one line per message (`observedMessagesText`). Both
 * instants are read, so a note that merely opens on the marker's words is not
 * mistaken for the turn. A note that does not hold to the shape is drawn as
 * the words it is.
 */
interface ObservedMessages {
  /** The chat as the envelope names it. */
  readonly title: string;
  /** The lines the chat gained, the cut line among them where the brain wrote one. */
  readonly lines: readonly string[];
  /** How many lines are the chat's own, the cut line not among them. Lines, not messages: a message may span several, and the row keeps no boundary between them. */
  readonly count: number;
}

/** The parts an envelope holds: the provider, the chat's name, and its instant at the least; a workspace at the most. */
const ENVELOPE_PARTS = { MINIMUM: 3, MAXIMUM: 4 } as const;

function isInstant(text: string): boolean {
  return Result.isSuccess(readEither(Schema.DateTimeUtcFromString)(unparsedWire(text)));
}

/** The chat's name from the bracketed envelope, or nothing when the line is not one. */
function envelopeTitle(line: string): string | undefined {
  if (!line.startsWith("[") || !line.endsWith("]")) return undefined;
  const parts = line.slice(1, -1).split(ENVELOPE_SEPARATOR);
  // The workspace is the one part the brain may leave out, so the name is read
  // from the end. A title carrying the separator makes more parts than the
  // brain writes, and the note is drawn as its words rather than misnamed.
  if (parts.length < ENVELOPE_PARTS.MINIMUM || parts.length > ENVELOPE_PARTS.MAXIMUM) {
    return undefined;
  }
  const instant = parts.at(-1);
  const title = parts.at(-2);
  if (instant === undefined || title === undefined || !isInstant(instant)) return undefined;
  return title;
}

function observedMessagesOf(text: string): ObservedMessages | undefined {
  if (!text.startsWith(BRAIN_INPUT_MARKER.OBSERVED_MESSAGES)) return undefined;
  const [marker, envelope, ...lines] = text.split("\n");
  if (marker === undefined || envelope === undefined) return undefined;
  // The marker line is the marker, one space, and the instant, and nothing else.
  const after = marker.slice(BRAIN_INPUT_MARKER.OBSERVED_MESSAGES.length);
  if (!after.startsWith(" ") || !isInstant(after.slice(1))) return undefined;
  const title = envelopeTitle(envelope);
  if (title === undefined) return undefined;
  const cut = lines[0] === OBSERVED_MESSAGES_CUT ? 1 : 0;
  return { title, lines, count: lines.length - cut };
}

function linesCount(count: number): string {
  return count === 1 ? "1 new line" : `${count} new lines`;
}

/**
 * The messages a chat gained that opened one of Luke's own turns, drawn as a
 * note rather than the lines they are: the chat's name and how many lines it
 * gained, on the line of a fold drawn like the tool calls', closed until
 * pressed, with the lines themselves preformatted behind it, so what woke
 * him stays readable when the count is not enough. Lines rather than
 * messages, because a message may span several and the row keeps no boundary
 * between them. It carries no copy control, as no note of the brain's does.
 */
function ObservedMessagesRow({
  observed,
  at,
}: {
  observed: ObservedMessages;
  at: number;
}): React.JSX.Element {
  return (
    <li
      className="conversation-entry"
      data-speaker={VOICE.NOTE.speaker}
      data-observed-messages={observed.count}
    >
      <small className="visually-hidden">{VOICE.NOTE.label}</small>
      <div className="conversation-message">
        <span className="conversation-bubble">
          <details className="conversation-observed">
            <summary className="conversation-turn-summary">
              <ChevronIcon />
              <span>{`${observed.title} — ${linesCount(observed.count)}`}</span>
            </summary>
            <div className="markdown">
              <pre>
                <code>{observed.lines.join("\n")}</code>
              </pre>
            </div>
          </details>
        </span>
      </div>
      <RowStamp at={at} />
    </li>
  );
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

/**
 * How the thread's rows read one another aloud: by message id, the rows of
 * the voice model's that were read from a message — its reply spoken after
 * its turn, its briefing said — and every message by its id, so a reading
 * finds what it read from wherever in the thread that message stands.
 */
interface Readings {
  readonly readOf: ReadonlyMap<string, readonly ConversationViewMessage[]>;
  readonly byId: ReadonlyMap<string, ConversationViewMessage>;
}

/** The message a row of the voice model's was read from, by the id its metadata names; nothing for words of his own. */
function readFromOf(view: ConversationViewMessage): string | undefined {
  const { message } = view;
  if (message.role !== MESSAGE_ROLE.ASSISTANT) return undefined;
  if (message.metadata.author !== MESSAGE_AUTHOR.VOICE_MODEL) return undefined;
  return message.metadata.read_from;
}

/** The readings of the thread, folded once from every group before any row is drawn. */
function readingsOf(groups: readonly ConversationViewTurnGroup[]): Readings {
  const readOf = new Map<string, ConversationViewMessage[]>();
  const byId = new Map<string, ConversationViewMessage>();
  for (const group of groups) {
    for (const message of group.messages) {
      byId.set(message.message.id, message);
      const from = readFromOf(message);
      if (from === undefined) continue;
      const standing = readOf.get(from);
      if (standing === undefined) readOf.set(from, [message]);
      else standing.push(message);
    }
  }
  return { readOf, byId };
}

/** The text a reading says, for the rating draft that quotes it and the bubble that draws it. */
function spokenWords(message: StoredUIMessage): string {
  return userWords(message);
}

/**
 * Whether a part draws words Luke said: a text part that is not his thinking,
 * or an announce call carrying its briefing. A fold of thinking draws words
 * too, but none he said, so the rating never stands on one.
 */
function drawsWords(
  part: StoredPart,
  described: ReadonlyMap<string, ConversationViewToolPart>,
  thinking: boolean,
): boolean {
  if (isTextPart(part)) return !thinking;
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
 * composed from its own part. In a turn whose answer the voice said, the
 * brain's text is his thinking and folds as his written working, whatever
 * the voice made of it; the rating of the brain's judgment then stands on the
 * voice's reading of it, where the record ties one to the journal, and on no
 * fold of thinking.
 */
function messageRows(
  view: ConversationViewMessage,
  judgment: Judgment,
  pending: boolean,
  aloud: boolean,
  roster: readonly SessionView[],
  rating: RatingContext,
  readings: Readings,
  onOpenChat?: (identity: SessionIdentity) => void,
  lead?: React.ReactNode,
): readonly React.JSX.Element[] {
  const { message } = view;
  if (message.role === MESSAGE_ROLE.USER) {
    const voice = userVoice(message);
    const words = userWords(message);
    // An observed-messages turn is the brain's alone: the developer's words and
    // the voice model's are drawn as they are, whatever they open with.
    const observed =
      message.metadata.author === MESSAGE_AUTHOR.BRAIN ? observedMessagesOf(words) : undefined;
    if (observed !== undefined) {
      return [<ObservedMessagesRow key={message.id} observed={observed} at={view.placedAt} />];
    }
    return [
      <BubbleRow
        key={message.id}
        voice={voice}
        words={words}
        at={view.placedAt}
        copy={voice === VOICE.YOU}
      />,
    ];
  }
  if (message.role === MESSAGE_ROLE.SYSTEM) return [];
  // A row of the voice model's read from a message in the thread is the words
  // actually said: its bubble carries the rating of the message it read from,
  // on the last of that message's readings, since the rating is of the
  // brain's judgment and there is one control per message.
  const readFrom = readFromOf(view);
  const source = readFrom === undefined ? undefined : readings.byId.get(readFrom);
  if (source !== undefined) {
    const words = spokenWords(message);
    const last = readings.readOf.get(source.message.id)?.at(-1) === view;
    return [
      <BubbleRow
        key={message.id}
        voice={VOICE.LUKE}
        words={words}
        at={view.placedAt}
        reading={true}
        rating={last ? ratingControl(source, words, rating) : undefined}
      />,
    ];
  }
  // A briefing a device read aloud folds as the brain's written words: what was
  // said stands as the reading's bubble, and the rating control moves there with it.
  const readAloud = (readings.readOf.get(message.id)?.length ?? 0) > 0;
  // The brain's text in a turn the voice answered is his thinking, said by nobody.
  const thinking = aloud && message.metadata.author === MESSAGE_AUTHOR.BRAIN;
  const described = new Map<string, ConversationViewToolPart>(
    view.tools.map((tool) => [tool.toolCallId, tool]),
  );
  const rows: React.JSX.Element[] = [];
  const toolCalls: ToolCall[] = [];
  // The control stands on the message's last words, so one message takes one.
  const lastWordsAt = message.parts.findLastIndex((part: StoredPart) =>
    drawsWords(part, described, thinking),
  );
  const control =
    lastWordsAt === -1 || readAloud
      ? undefined
      : ratingControl(view, quotedWords(message, message.parts[lastWordsAt]), rating);
  // The lead stands before the message's first words, and nowhere twice.
  const leadAt = lead === undefined ? -1 : message.parts.findIndex(isTextPart);
  message.parts.forEach((part: StoredPart, index) => {
    const key = `${message.id}:${index}`;
    const placed = index === lastWordsAt ? control : undefined;
    if (isTextPart(part)) {
      if (thinking) {
        rows.push(<WrittenRow key={key} words={part.text} />);
        return;
      }
      rows.push(
        judgment === JUDGMENT.OWN ? (
          <OwnWordsRow
            key={key}
            words={part.text}
            at={view.placedAt}
            lead={index === leadAt ? lead : undefined}
            rating={placed}
          />
        ) : (
          <BubbleRow
            key={key}
            voice={VOICE.LUKE}
            words={part.text}
            at={view.placedAt}
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
      if (words !== undefined && readAloud) {
        rows.push(<WrittenRow key={key} words={words} />);
        return;
      }
      if (words !== undefined) {
        rows.push(
          <BubbleRow
            key={key}
            voice={VOICE.LUKE}
            words={words}
            at={view.placedAt}
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
    return [toolCallRow(only, judgment, view.placedAt, onOpenChat), ...rows];
  }
  return [
    <ToolCallsFold
      key={`${message.id}:tools`}
      rows={toolCalls.map((call) => toolCallRow(call, judgment, undefined, onOpenChat))}
      pending={pending}
      judgment={judgment}
      at={view.placedAt}
    />,
    ...rows,
  ];
}

/** The user-facing voice for each kind of line still being said, before the record it settles into arrives. */
function liveEntryVoice(kind: ConversationEntryKind): RowVoice {
  switch (kind) {
    case CONVERSATION_ENTRY_KIND.ASK:
      return VOICE.YOU;
    case CONVERSATION_ENTRY_KIND.REPLY:
    case CONVERSATION_ENTRY_KIND.ANNOUNCEMENT:
    // An action Luke took on his own judgment is drawn as his own line, never as
    // the developer's request; the attribution lives in the stored kind.
    case CONVERSATION_ENTRY_KIND.OWN_ACTION:
      return VOICE.LUKE;
    case CONVERSATION_ENTRY_KIND.ACTION:
      return { speaker: CONVERSATION_ENTRY_SPEAKER.EVENT, label: "At your request" };
  }
}

/**
 * A line still being said, drawn as the bubble it will settle into: words
 * growing, no timestamp, and no copy, because copying half a sentence would
 * copy half a sentence. The settled line arrives from the service as a
 * stored message and is drawn by the turn renderer; this bubble is drawn
 * until a row of the call stands for it (`conversation-live-lines.ts`), so
 * the words never leave the screen between the saying and the read.
 */
function ConversationStreamingRow({ entry }: { entry: ConversationEntry }): React.JSX.Element {
  const voice = liveEntryVoice(entry.kind);
  return (
    <li className="conversation-entry" data-speaker={voice.speaker} data-streaming="true">
      <small className="visually-hidden">{voice.label}</small>
      <div className="conversation-message">
        <span className="conversation-bubble">
          <MarkdownMessage words={entry.words} className="conversation-words" />
        </span>
      </div>
    </li>
  );
}

/**
 * The lines still being said in the order their rows will land: by instant
 * where one is known, and after every dated line, in the order reported,
 * where none is. A line has no durable id and its words change on every
 * delta, so its key is its place in the report, which holds still for
 * exactly as long as the line does.
 */
function placedLiveRows(
  live: readonly PlacedLiveEntry[],
): { at: number | undefined; row: React.JSX.Element }[] {
  return live
    .map((line, index) => ({
      at: line.at,
      row: <ConversationStreamingRow key={`live:${line.entry.kind}:${index}`} entry={line.entry} />,
    }))
    .sort((left, right) => {
      if (left.at === undefined || right.at === undefined) {
        return Number(left.at === undefined) - Number(right.at === undefined);
      }
      return left.at - right.at;
    });
}

/** When a turn's rows begin and end: where its earliest and latest messages are placed, which is what dates the silence around it. */
function groupSpan(group: ConversationViewTurnGroup) {
  const instants = group.messages.map((message) => message.placedAt);
  return { first: Math.min(...instants), last: Math.max(...instants) };
}

/**
 * The thread as turns. Each group's messages draw in sequence, and every
 * assistant message that carried tool calls opens with them — one as a row,
 * more as one fold — before the words that followed. A turn still running ends in Luke's wait,
 * driven by the turn row's own status and nothing else. A turn that followed
 * a long silence is dated over it. A line still being said is drawn where
 * its row will land, ahead of the first turn placed after it, or after the
 * last turn where no instant is known for it yet; and whatever the caller
 * hands in as children — the developer's place, a wait no stored turn
 * carries yet — closes the list, so the thread is one list under one snap
 * point.
 */
export function ConversationTurns({
  groups,
  roster = [],
  subagents = [],
  onOpenChat,
  onOpenChild,
  onOfferRatingFeedback,
  now,
  live = [],
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
  /** The account's children as the document holds them, so a completion's chip names the child by the list's own title. */
  subagents?: readonly ChildRead[];
  /** The row's own press by identity; absent where nothing can open a session, and every chip is a name. */
  onOpenChat?: (identity: SessionIdentity) => void;
  /** The list row's own press by child id, for the chip on a completion; absent where the thread opens no transcript. */
  onOpenChild?: (childId: string) => void;
  /** Opens the feedback composer on the draft a thumbs down offers; absent where no composer can be offered. */
  onOfferRatingFeedback?: (draft: string) => void;
  /** The instant a running turn's wait is read against; passed down because only the app knows which clock is honest. */
  now: number;
  /** The lines still being said, each with the instant its row will be placed at where the record has told one. */
  live?: readonly PlacedLiveEntry[];
  /** Rows drawn after the last turn, inside the same list. */
  children?: React.ReactNode;
}): React.JSX.Element {
  let previousAt: number | undefined;
  const readings = readingsOf(groups);
  // The lines still being said are dealt out ahead of each turn placed after
  // them, so a line whose row is not yet on record stands where the row will.
  const liveRows = placedLiveRows(live);
  let nextLive = 0;
  const liveBefore = (instant: number | undefined): React.JSX.Element[] => {
    const rows: React.JSX.Element[] = [];
    for (; nextLive < liveRows.length; nextLive += 1) {
      const line = liveRows[nextLive];
      if (line === undefined) break;
      if (instant !== undefined && (line.at === undefined || line.at >= instant)) break;
      rows.push(line.row);
    }
    return rows;
  };
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
        const aloud = answeredAloud(group.turn);
        // A child's completion leads Luke's first words on it with the chip
        // naming the child: the first of his messages in the turn with words,
        // since one that only called tools has no words to lead.
        const completedChild = completedChildOf(group);
        const led =
          completedChild === undefined
            ? undefined
            : group.messages.find(
                (message) =>
                  message.message.role === MESSAGE_ROLE.ASSISTANT &&
                  message.message.parts.some(isTextPart),
              );
        // The ask a rated reply answered is the developer's latest words in
        // the same turn before it; a turn Luke opened himself answered none.
        let ask: string | undefined;
        const drawn = group.messages.flatMap((message) => {
          const rows = messageRows(
            message,
            judgment,
            pending,
            aloud,
            roster,
            {
              ask,
              onOfferFeedback: onOfferRatingFeedback,
            },
            readings,
            onOpenChat,
            completedChild !== undefined && message === led ? (
              <SubagentChip
                childId={completedChild}
                subagents={subagents}
                {...(onOpenChild ? { onOpenChild } : undefined)}
              />
            ) : undefined,
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
          ...liveBefore(span.first),
          ...(dated
            ? [
                <ConversationTimeBreak
                  key={`${group.turnId}:break`}
                  recordedAt={span.first}
                  now={now}
                />,
              ]
            : []),
          ...(group.source.kind === CONVERSATION_VIEW_SOURCE.OBSERVED
            ? [
                <SourceRow
                  key={group.turnId}
                  source={group.source}
                  roster={roster}
                  {...(onOpenChat ? { onOpenChat } : undefined)}
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
      {liveBefore(undefined)}
      {children}
    </ol>
  );
}
