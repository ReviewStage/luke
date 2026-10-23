import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import {
  fieldValueWords,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxBlock,
  type InboxFormValue,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  inboxAnswerHeard,
  knownBlock,
  knownResponse,
} from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { CatalogModel } from "@luke/features/models-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BADGE_TONE,
  BackIcon,
  Badge,
  Breadcrumbs,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CardHead,
  CHOICE_FLOW,
  CHOICE_LOOK,
  CHOICE_TONE,
  ChoiceList,
  type Crumb,
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  EllipsisIcon,
  ErrorState,
  Fill,
  FoldingButton,
  type FoldingButtonHint,
  GAP,
  IconButton,
  LAYOUT_ELEMENT,
  ONE_LINE_END,
  Stack,
  SteppedBack,
  TEXT_TONE,
  Text,
  Time,
  Tooltip,
  useMenu,
  useMinute,
} from "@luke/ui";
import {
  ACTOR_KIND,
  type Actor,
  accountActor,
  actorName,
  memberActor,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import { isWireString } from "@luke/wire";
import { CheckIcon, CircleSlashIcon, ClockIcon, FactoryIcon } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActorLine, ActorRef, AutomationCard } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { useAutomation } from "../automation-directory.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { TextLink } from "../text-link.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import {
  AgentActorRef,
  AgentCard,
  type AgentSubject,
  agentSubject,
  NOTHING_HELD,
} from "./agent-ref.js";
import { AttachedFileChips } from "./attached-file-chips.js";
import { InboxAnswerBox } from "./inbox-answer-box.js";
import {
  ANSWERED,
  AnsweredCard,
  AskControls,
  bareKey,
  ChoiceOptions,
  choiceOptions,
  DraftQuestion,
  FormFields,
  focusMissing,
  HeldControls,
  hasControls,
  heldStill,
  OPTION_NUMBER,
  OPTIONS_ATTRIBUTE,
  optionRows,
  sendFromPane,
  takesTyping,
  WaitingMarker,
  WithdrawnWhy,
  WithdrawnWords,
} from "./inbox-ask-controls.js";
import { askHeadWords } from "./inbox-ask-words.js";
import { type InboxCloser, useInboxClose } from "./inbox-close.js";
import { InboxCodeCard, type InboxCodeDoors } from "./inbox-code-card.js";
import { COMMENT, Comment, CommentName, THREAD_TIME_CLASS } from "./inbox-comment.js";
import { type FormTextDoors, InboxFormText } from "./inbox-form-text.js";
import {
  answerOf,
  askNumberedPick,
  CLOSED_WORDS,
  decidedOf,
  decisionsOf,
  EMPTY_INBOX_DRAFT,
  INBOX_HOLDER,
  type InboxDecided,
  type InboxDraft,
  type InboxHolder,
  type InboxKnownAsk,
  inboxCommentFiles,
  inboxFileChips,
  inboxThreadOf,
  inboxWaitsOn,
  isUnread,
  itemWorkspaceId,
  knownAsk,
  numberedPick,
  openAskOf,
  proposedOptions,
  readersItem,
  repliedDraft,
  SETTLED_BY,
  sentenceCased,
  sentStamp,
  settledAt,
  settlementOf,
  THREAD_ENTRY,
  threadCut,
  threadEntries,
  withDecision,
} from "./inbox-model.js";
import { type InboxNext, InboxNextUp, type InboxPager, InboxPagerControls } from "./inbox-pager.js";
import { InboxPicture, InboxPictures } from "./inbox-pictures.js";
import { InboxStamp } from "./inbox-stamp.js";
import { LoneLinkCards } from "./lone-link-card.js";
import { REPLY_SCOPE } from "./reply-to-selection.js";
import { SentWords } from "./skill-chip.js";
import { TAB_KIND, tabLook } from "./tab-look.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { markReadItem } from "./task-menu-items.js";
import { cardTitle } from "./tool-call-model.js";
import { TranscriptWords } from "./transcript-blocks.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { WordsWorkspace } from "./use-link-standing.js";
import { opensAsLink } from "./use-open-link.js";
import type { TaskInboxControl } from "./use-task-inbox.js";

/**
 * inbox-pane.tsx -- one inbox item at reading size: a comment thread under the item's title, the agent's question, everything it offered, and its answer, given in place or as it was given.
 *
 * The item reads as a comment thread, as an issue or a pull request does:
 * its title alone leads as the thread's subject. Each message under it is a comment, headed
 * by its writer's chip, their face and name, and when, the chip's face
 * standing out on the line that runs down through every face to join the
 * comments, and its words indented under the name. The agent's
 * question comes first: the blocks of context the agent wrote, Markdown as the
 * transcript draws it, its links read under the item's own workspace, its
 * plan's or its agent's, a link as the transcript draws one, opened in the
 * browser where it is a web page, code as the Code tab draws a card
 * (`code-pane.tsx`), its lines read from GitHub at the agent's commit
 * through the File tab's own read and opened there in the File tab, and an
 * image the agent took in its sandbox, drawn from the bytes the host fetched
 * under the account (`use-plan-inbox.ts`) as a plan's or a transcript's
 * picture is (`picture-block.tsx`), up to the pane's width and no taller
 * than theirs, and opened larger over the window by a press, in the viewer
 * an attached file opens in (`attachment-viewer.tsx`). While the item
 * waits, the agent's message ends with a marker saying whom it waits on,
 * and what it asks for stands at the top of the reader's draft reply, the
 * thread's last comment, over the note: a choice's options, one perhaps recommended, a radio list where
 * it takes one and a checkbox list where it takes several, each numbered
 * for the key that picks it from anywhere in the Inbox but a field; an
 * approval's two cards, Approve and Decline, picked as a choice of two is,
 * a green or a red mark once picked; a to-do's card, its step beside a
 * checkbox and a "Couldn't do it" pill under it, picked the same way; a
 * form's fields stacked, each its name over its control at one left edge,
 * "Optional" after the name of one that may be left empty, a select's
 * options pills that wrap, a yes or no a checkbox, a number a short field,
 * and a text field the composer's own field with its mentions and skills
 * (`inbox-form-text.tsx`); nothing for words or a note. Enter on an option or in a field sends the answer as
 * the box's Send does, and never presses the option, Space and the arrow
 * keys being an option's own. The draft reply is the reader's chip, "You"
 * and nothing after it, over the agent composer's box, its card and its field, with
 * its `@` mentions, its skills, and its microphone (`inbox-answer-box.tsx`),
 * flowing at the thread's end rather than docked under it, and every item is sent by its one
 * Send, a note's reading "Got it" until a word is written. A card whose
 * agent need not hear back says whether its answer will message the agent:
 * a bare answer does not, and a typed note does. Once the item is
 * answered, the developer's answer follows as their comment, when and
 * whether it reached the agent as a message or was kept for it to read,
 * then the question's own controls as the answer left them, read-only and
 * at full strength (a choice's options with the pick checked, an
 * approval's or a to-do's cards with the decision checked, a form's fields
 * filled in, empty where left empty), or what they did as a chip where
 * the question has none, then what they
 * wrote, their note drawn as the agent's tab draws a sent message, its
 * mentions chips; or, the item taken back or its answer not read, what it
 * offered folds to one line, which opens to the options; or the agent's
 * comment says it took the item back, and
 * why. The thread's messages, a member's or the agent's, written at any
 * point, stand among these comments in the order they were written, each
 * by its writer's face and name, its words and then its files drawn as an
 * answer's are; a thread read cut to its latest says the earlier ones are
 * in the agent's tab. The draft reply ends a settled item's thread too,
 * where it writes a message on the thread rather than an answer, the next
 * item that needs the developer docked under the board. The board is a
 * log, as an agent's transcript is: each item opens at its newest message,
 * the draft reply just over the board's foot, and keeps to it as messages
 * land while the reader is there; scrolled up, the transcript's way back
 * to the newest line floats over the foot; and the reader's own message,
 * sent while scrolled up, is scrolled into view as it lands, the draft
 * under it. A block or a response of a type
 * this build does not know, one a newer service wrote, is drawn as a line
 * naming a newer Luke, so the rest still reads. The pane's bar is its
 * path, task › agent, each crumb drawn as its tab in the task's column,
 * opening what it names and hanging the card its sidebar row or tab
 * hangs, after a way back to the list where the item stands alone, and
 * nothing else that opens the agent, since its name does. Wherever the
 * thread names the agent, its subject's line, its comments, and the line
 * saying an answer was sent to it, the name is the agent's own reference
 * (`agent-ref.tsx`): its tab's card on hover, its tab on a press, an
 * archived agent's card saying so. Every time shows its moment in the
 * shared tooltip, and an agent this window does not list, one started on
 * another Mac, still leads with a glyph. The pane shows words an agent
 * wrote, a code block the repository's lines, and an image block a picture of what it rendered,
 * so its thread is out of the session recording (`ph-no-capture`), and the
 * viewer, drawn over the window outside it, is out of it on its own.
 *
 * An item from version 5 is drawn as its thread instead (`inbox-model.ts`'s
 * `inboxThreadOf`): under its title alone, every message, oldest first,
 * each a Markdown document by its writer's face and name, drawn with the
 * item's own pictures, pairs, and lone-link cards, and its files after it,
 * never as a strip over its words: a picture its words draw stands there
 * alone, every other one as a picture after them, and any other file as its
 * chip (`CommentFiles`). A member's answer
 * leads with the ask's card it answered, its kind and how it was answered
 * at its head and its controls under it as the answer left them,
 * read-only; where the thread read no longer carries the ask, it leads
 * with its stamp (`inbox-stamp.tsx`) and its values listed. An agent's message that asks
 * ends, while the ask waits, with its marker alone, its controls standing
 * in the draft reply over the note: a `decide`'s numbered options or two
 * small buttons, a `do`'s steps with Mark done and Couldn't do it, an
 * `answer`'s fields, filled in part or whole, or its Answer; each attaches
 * its answer to the reply rather than sending it, and a press pressed
 * again takes it off. Answered, it leaves the agent's message
 * for the reply that answered it, or says "Answered" alone where that
 * reply is no longer read; replaced, it keeps its controls as it offered
 * them, stepped back to the muted ink and taking nothing, over a pill
 * saying a newer question, or message, replaced it; withdrawn, the same
 * over a pill saying so and its why as a muted sentence, or who closed the
 * item.
 *
 * Words selected in what the agent wrote, its question's Markdown, its
 * messages on the thread, and why it took the item or an ask back, stand
 * Reply over them, as an agent's words do in its tab
 * (`reply-to-selection.tsx`): a
 * press lays them into the box as a quote block, so an answer or a message
 * can answer the agent point by point. Reply stands only while the box
 * takes a quote: never while an answer is out, a dictation holds the box,
 * or its editor is still loading (`inbox-answer-box.tsx`).
 */

/** What the thread says under its item where the task's inbox could not be read. */
const INBOX_FAILED_LINE = "The inbox could not be read.";

/** What an answer says of the files whose read did not answer. */
const FILES_FAILED_LINE = "Some files could not be read.";

/** What a card says of a block or a response this build does not know. */
const NEWER_LUKE = {
  BLOCK: "Open this in a newer Luke to see the rest.",
} as const;

/** What the way back from an item standing alone to the list says it does. */
const BACK_TO_INBOX = "Back to inbox";

/**
 * The way back's pill, which says where it goes and names Back's chord
 * whether its word is folded away or not. Note that it drops the folded
 * label it is handed, because the pill says more than the word does.
 */
const BackHint: FoldingButtonHint = ({ children }) => (
  <Tooltip label={BACK_TO_INBOX} command={APP_COMMAND.BACK}>
    {children}
  </Tooltip>
);

/** A link block: a plain link where it is a web page, as a transcript's links are, else its label with the address beside it to copy. */
export function LinkBlock({
  url,
  label,
  openLink,
}: {
  url: string;
  label: string;
  openLink: (url: string) => void;
}): React.JSX.Element {
  if (opensAsLink(url)) {
    return (
      <TextLink href={url} words={label} onOpen={openLink}>
        {label}
      </TextLink>
    );
  }
  return (
    <Tooltip label={url}>
      <span className="text-link-inert">
        {label} <span className="inbox-link-address">{url}</span>
      </span>
    </Tooltip>
  );
}

/** One block this build knows, drawn as its type is. */
function KnownBlock({
  block,
  openLink,
  code,
}: {
  block: InboxBlock;
  openLink: (url: string) => void;
  code: InboxCodeDoors;
}): React.JSX.Element {
  switch (block.type) {
    case INBOX_BLOCK.MARKDOWN:
      // The agent's words, which a selection inside may be replied to.
      return (
        <div data-inbox-markdown="" {...{ [REPLY_SCOPE]: "" }}>
          <TranscriptWords text={block.text} asDocument />
        </div>
      );
    case INBOX_BLOCK.LINK:
      return (
        <p className="inbox-words">
          <LinkBlock url={block.url} label={block.label} openLink={openLink} />
        </p>
      );
    case INBOX_BLOCK.CODE:
      return <InboxCodeCard block={block} code={code} />;
    case INBOX_BLOCK.IMAGE:
      return (
        <div data-inbox-image="">
          <InboxPicture attachmentId={block.attachmentId} alt={block.alt} caption={undefined} />
        </div>
      );
  }
}

/** The item's context: each block in turn, drawn as its type is, and a line for one this build does not know. */
function Blocks({
  item,
  openLink,
  code,
}: {
  item: InboxItem;
  openLink: (url: string) => void;
  code: InboxCodeDoors;
}): React.JSX.Element | null {
  if (item.blocks.length === 0) return null;
  return (
    <Stack gap={GAP.CONTROL}>
      {item.blocks.map((block, index) =>
        // Blocks have no key of their own, and are never reordered: a change to an item draws them whole again.
        knownBlock(block) ? (
          <KnownBlock key={index} block={block} openLink={openLink} code={code} />
        ) : (
          <Text key={index} tone={TEXT_TONE.MUTED}>
            {NEWER_LUKE.BLOCK}
          </Text>
        ),
      )}
    </Stack>
  );
}

/** What an approval's cards are named by, for a reader that does not see the question over them. */
const DECISION_LEGEND = "Decision";

/** What a to-do's card is named by, for a reader that does not see the question over it. */
const TODO_LEGEND = "To-do";

/** What each decision's mark fills with once picked: going ahead in green, holding back in red. */
const DECISION_TONE = [CHOICE_TONE.COMPLETE, CHOICE_TONE.DANGER] as const;

/**
 * A response's two decisions as cards, numbered for the keys that pick
 * them, the pick's mark green for going ahead and red for holding back, and
 * the pick waiting for Send: an approval's Approve and Decline side by side,
 * and a to-do's step, the item's own title, over its "Couldn't do it".
 * Read-only, they are the decision as it was given, unnumbered.
 */
function DecisionCards({
  response,
  draft,
  disabled,
  readOnly = false,
  todo,
  onDraft,
}: {
  response: InboxDecided;
  draft: InboxDraft;
  disabled: boolean;
  readOnly?: boolean;
  /** The to-do's title, which names its step, where the response is a to-do. */
  todo?: string | undefined;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const decided = decidedOf(response, draft);
  return (
    <div {...(readOnly ? {} : { [OPTIONS_ATTRIBUTE]: "" })}>
      <ChoiceList
        legend={todo === undefined ? DECISION_LEGEND : TODO_LEGEND}
        options={decisionsOf(response).map((decision, index) => ({
          value: decision.reply,
          label: index === 0 && todo !== undefined ? todo : decision.label,
          tone: DECISION_TONE[index],
        }))}
        value={decided === undefined ? [] : [decided]}
        look={CHOICE_LOOK.MARKED}
        flow={todo === undefined ? CHOICE_FLOW.ACROSS : CHOICE_FLOW.DOWN}
        numbered={!readOnly}
        clearable
        disabled={disabled}
        readOnly={readOnly}
        onChange={(picked) => {
          const [reply] = picked;
          onDraft(reply === undefined ? { ...draft, choices: [] } : withDecision(draft, reply));
        }}
      />
    </div>
  );
}

/**
 * The controls an item's response puts between its blocks and its box: a
 * choice's options, an approval's or a to-do's cards, a form's fields,
 * nothing for the rest; read-only, as the answer the draft holds left them.
 */
function ResponseControls({
  item,
  draft,
  disabled,
  readOnly = false,
  text,
  onDraft,
}: {
  item: InboxItem;
  draft: InboxDraft;
  disabled: boolean;
  readOnly?: boolean;
  /** What a form's text fields are written with. */
  text: FormTextDoors | undefined;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element | null {
  const response = item.response;
  if (!knownResponse(response)) return null;
  switch (response.type) {
    case INBOX_RESPONSE.CHOICE:
      return (
        <ChoiceOptions
          choice={response}
          draft={draft}
          disabled={disabled}
          numbered
          readOnly={readOnly}
          onDraft={onDraft}
        />
      );
    case INBOX_RESPONSE.APPROVAL:
      return (
        <DecisionCards
          response={response}
          draft={draft}
          disabled={disabled}
          readOnly={readOnly}
          onDraft={onDraft}
        />
      );
    case INBOX_RESPONSE.TODO:
      return (
        <DecisionCards
          response={response}
          draft={draft}
          disabled={disabled}
          readOnly={readOnly}
          todo={cardTitle(item.title)}
          onDraft={onDraft}
        />
      );
    case INBOX_RESPONSE.FORM:
      return (
        <FormFields
          form={response}
          draft={draft}
          disabled={disabled}
          readOnly={readOnly}
          text={
            text === undefined ? undefined : (props) => <InboxFormText {...props} doors={text} />
          }
          onDraft={onDraft}
        />
      );
    default:
      return null;
  }
}

/** The responses whose controls a settled item from before version 5 draws filled in with its answer. */
const FILLED_RESPONSES: ReadonlySet<string> = new Set([
  INBOX_RESPONSE.CHOICE,
  INBOX_RESPONSE.APPROVAL,
  INBOX_RESPONSE.TODO,
  INBOX_RESPONSE.FORM,
]);

/** Whether an item's response has controls of its own, which an open one draws in the draft reply. */
function drawsControls(item: InboxItem): boolean {
  return knownResponse(item.response) && FILLED_RESPONSES.has(item.response.type);
}

/** Whether a settled item's question draws its controls filled in with its answer: one answered, whose answer its read carries, of a response with controls. */
function drawsAnswered(item: InboxItem): boolean {
  return (
    item.status === INBOX_STATUS.ANSWERED &&
    item.answer !== undefined &&
    FILLED_RESPONSES.has(item.response.type)
  );
}

/**
 * What a settled item's question ends with: nothing where it was answered
 * and its read carries the answer, which the answer's comment draws in the
 * question's controls (`AnsweredResponse`); otherwise what it offered,
 * folded (`Offered`), as one taken back or one whose answer the read lacks.
 */
function SettledResponse({ item }: { item: InboxItem }): React.JSX.Element | null {
  // Keyed by its item, so the fold opened on one item stands closed on the next.
  return drawsAnswered(item) ? null : <Offered key={item.id} item={item} />;
}

/**
 * A settled item's answer as the question's own controls, read-only, as
 * they stood when it was sent (`ResponseControls`), which leads the
 * answerer's comment; nothing where its read lacks the answer.
 */
function AnsweredResponse({ item }: { item: InboxItem }): React.JSX.Element | null {
  if (!drawsAnswered(item) || item.answer === undefined) return null;
  return (
    <div data-inbox-answered="">
      <ResponseControls
        item={item}
        draft={repliedDraft(item.answer)}
        disabled={false}
        readOnly
        text={undefined}
        onDraft={heldStill}
      />
    </div>
  );
}

/** The responses whose options a number key picks: a choice's, and an approval's or a to-do's two. */
const NUMBERED_RESPONSES: ReadonlySet<string> = new Set([
  INBOX_RESPONSE.CHOICE,
  INBOX_RESPONSE.APPROVAL,
  INBOX_RESPONSE.TODO,
]);

/** How a number key picks an open item's option: the draft after the option numbered is picked, or none where it has none. */
type NumberedPick = (draft: InboxDraft, number: number) => InboxDraft | undefined;

/**
 * How the number keys pick an open item's options, or none where it has
 * none they pick: on a thread, its open `decide`'s; otherwise a choice's,
 * or an approval's or a to-do's two.
 */
function numberedPickOf(
  item: InboxItem,
  thread: readonly InboxMessage[] | undefined,
): NumberedPick | undefined {
  if (thread === undefined) {
    if (!NUMBERED_RESPONSES.has(item.response.type)) return undefined;
    return (draft, number) => numberedPick(item, draft, number);
  }
  const ask = openAskOf(thread)?.ask;
  if (ask === undefined || !knownAsk(ask) || ask.type !== INBOX_ASK.DECIDE) return undefined;
  return (draft, number) => askNumberedPick(ask, draft, number);
}

/**
 * The number keys pick an open item's options, a choice's or an approval's
 * or a to-do's two, or a thread's open `decide`'s, 1 the first, as a press on
 * the option would, and take the keyboard to it, wherever in the Inbox the
 * developer stands but a field or an editor, whose keys are its own, and
 * never under a dialog. Note that the keys are heard on the document,
 * because a reader stepping the list with J and K holds the keyboard on its
 * row rather than in the pane.
 */
function useOptionNumbers(
  pane: React.RefObject<HTMLElement | null>,
  item: InboxItem,
  draft: InboxDraft,
  control: TaskInboxControl,
  pick: NumberedPick | undefined,
): void {
  const latest = useRef({ item, draft, control, pick });
  latest.current = { item, draft, control, pick };
  const numbered = pick !== undefined;
  useEffect(() => {
    if (!numbered) return;
    const onKey = (event: KeyboardEvent) => {
      const { item, draft, control, pick } = latest.current;
      const shown = pane.current;
      if (!OPTION_NUMBER.test(event.key) || !bareKey(event) || event.shiftKey) return;
      if (event.defaultPrevented || event.isComposing || takesTyping(event.target)) return;
      if (
        shown === null ||
        shown.hidden ||
        document.querySelector('[aria-modal="true"]') !== null
      ) {
        return;
      }
      const inbox = shown.parentElement;
      const from = event.target;
      if (from !== document.body && !(from instanceof Node && inbox?.contains(from) === true))
        return;
      const number = Number(event.key);
      const picked = pick?.(draft, number);
      if (picked === undefined) return;
      event.preventDefault();
      control.onDraft(item, picked);
      optionRows(shown)[number - 1]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [numbered, pane]);
}

/** The item's agent as the pane names it, the catalog its card names the model from, and the press that opens its tab. */
interface ItemAgent {
  readonly subject: AgentSubject;
  readonly models: readonly CatalogModel[] | undefined;
  readonly onOpen: () => void;
}

/** The agent in a line of the thread: its tile and name, which hang its card and open its tab. */
function AgentName({ by }: { by: ItemAgent }): React.JSX.Element {
  return <AgentActorRef subject={by.subject} models={by.models} onOpen={by.onOpen} />;
}

/** What a settled item's line says of where the answer went: to the agent as a message, its name its reference, or, a bare press on an item asking nothing back, kept for it to read. */
function Delivered({ item, by }: { item: InboxItem; by: ItemAgent }): React.JSX.Element {
  // Note that an answered item the wire carries without its answer was heard where it asked to be.
  const heard =
    item.answer === undefined
      ? item.needsReply
      : inboxAnswerHeard(item, item.answer, item.answerFiles);
  if (!heard) return <>Saved for the agent to read</>;
  return (
    <ActorLine>
      {"Sent to "}
      <AgentName by={by} />
    </ActorLine>
  );
}

/**
 * What a settled item offered, as a settled ChoiceList: the developer's
 * pick in the look of a picked option, a check and whose pick it was,
 * "Your pick" or "Charles Pan’s pick", beside its label, and the rest
 * stepped back to an outline, so what was offered and what was chosen read
 * together. The option the agent recommended keeps its badge.
 */
function Proposal({ item }: { item: InboxItem }): React.JSX.Element | null {
  const answerer = usePerson(item.answeredBy);
  const options = proposedOptions(item);
  if (options.length === 0) return null;
  return (
    <ChoiceList
      legend="What the agent offered"
      options={choiceOptions(options)}
      value={options.filter((option) => option.picked).map((option) => option.label)}
      settled
      pickedNote={
        <ActorLine>
          <ActorRef actor={answerer} possessive />
          {" pick"}
        </ActorLine>
      }
    />
  );
}

/** How many options a settled item's fold says it offered. */
function optionsWords(count: number): string {
  return count === 1 ? "1 option" : `${count} options`;
}

/**
 * What a settled item offered, folded to one line, as the transcript folds
 * a finished step: how many options there were and who picked which, "2
 * options · you picked Retry once", or that they were offered where the
 * agent took the item back. Opened, it shows them as they were
 * (`Proposal`).
 */
function Offered({ item }: { item: InboxItem }): React.JSX.Element | null {
  const answerer = usePerson(item.answeredBy);
  const options = proposedOptions(item);
  if (options.length === 0) return null;
  const picked = options.filter((option) => option.picked).map((option) => option.label);
  const who = actorName(answerer, { sentence: true });
  const summary =
    picked.length === 0
      ? `${optionsWords(options.length)} offered`
      : `${optionsWords(options.length)} · ${who} picked ${picked.join(", ")}`;
  return (
    <Disclosure data-inbox-offered="">
      <DisclosureSummary>
        <span>{summary}</span>
      </DisclosureSummary>
      <DisclosureBody inset={DISCLOSURE_BODY.FLUSH}>
        <Proposal item={item} />
      </DisclosureBody>
    </Disclosure>
  );
}

/** What the draft reply's head names the reader by, where nothing else names them. */
const DRAFT_HEAD = {
  YOU: "You",
} as const;

/** The reader as the window draws them: as the workspace's members list them, else as their account signs in, else by their id alone. */
function useReader(readerId: string | undefined): Actor {
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  const { members } = useMemberDirectory();
  const member = members?.find((each) => each.userId === readerId);
  if (member !== undefined) return memberActor(member, readerId);
  if (account?.status === ACCOUNT_STATUS.SIGNED_IN) return accountActor(account);
  // Note that a reader known by their id alone is still drawn as a person, by the words the head names them with.
  if (readerId !== undefined) {
    return { kind: ACTOR_KIND.PERSON, userId: readerId, name: DRAFT_HEAD.YOU, you: true };
  }
  return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED };
}

/**
 * The reader's reply not yet sent, as the thread's last comment, drawn as
 * a member's is: headed by the reader's own chip, "You", with nothing after
 * it, and the box under it, so what is sent drops into the thread in its
 * place and the box stands at the end again, as an issue's thread is
 * written on.
 */
function DraftReply({
  readerId,
  children,
}: {
  readerId: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const reader = useReader(readerId);
  return (
    <Comment
      kind={COMMENT.DRAFT}
      head={
        <CommentName>
          <ActorRef actor={reader} />
        </CommentName>
      }
    >
      {children}
    </Comment>
  );
}

/**
 * What the developer's answer leads with: what they picked, the options'
 * labels, unless the question draws them picked (`drawn`), or, where they
 * picked none and wrote nothing, what they did, "Acknowledged it"; nothing
 * where their words say it.
 */
function pickOf(
  item: InboxItem,
  did: string,
  words: string | undefined,
  drawn: boolean,
): string | undefined {
  const picked = proposedOptions(item).filter((option) => option.picked);
  if (picked.length > 0) return drawn ? undefined : picked.map((option) => option.label).join(", ");
  return words === undefined ? sentenceCased(did) : undefined;
}

/** The files of one comment, the words they follow, and how their bytes are read. */
interface CommentFilesProps {
  itemId: string;
  files: NonNullable<InboxItem["answerFiles"]>;
  /** The comment's words, whose own pictures stand where they name them; none where it wrote none. */
  words: string | undefined;
  images: TaskInboxControl["images"];
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
}

/**
 * The files the developer's answer or a message on the thread carried,
 * drawn over its words, as the agent's tab draws a sent message's and every
 * box holds them over what is typed. A picture its words
 * name already stands there, as an agent's do, so it is not drawn again;
 * every other picture is drawn as one in the words is, side by side where
 * several, the item's viewer walking it with the rest (`inbox-pictures.tsx`),
 * and any other file as the agent's tab draws a sent message's, its chip
 * (`attached-file-chips.tsx`). Each asks for its bytes as it is first
 * drawn, through the same read an image block's picture takes, and a chip
 * is drawn by its name alone until they land; where a file's read did not
 * answer, a line under the files says so with Retry, as a picture's does.
 */
function CommentFiles({
  itemId,
  files,
  words,
  images,
  onImage,
  onRetryImage,
}: CommentFilesProps): React.ReactNode {
  const { pictures, others } = useMemo(
    () => inboxCommentFiles(files, words, itemId),
    [files, words, itemId],
  );
  useEffect(() => {
    for (const file of others) {
      if (!images.has(file.attachmentId)) onImage(itemId, file.attachmentId);
    }
  }, [others, images, itemId, onImage]);
  const failed = others.filter((file) => {
    const read = images.get(file.attachmentId);
    return read !== undefined && "failed" in read;
  });
  return (
    <>
      {pictures.length === 0 ? null : (
        <div className="transcript-pictures" data-inbox-file-pictures="">
          {pictures.map((file) => (
            <InboxPicture
              key={file.attachmentId}
              attachmentId={file.attachmentId}
              alt={file.name}
              caption={undefined}
              name={file.name}
            />
          ))}
        </div>
      )}
      {others.length === 0 ? null : <AttachedFileChips files={inboxFileChips(others, images)} />}
      {failed.length === 0 ? null : (
        <div data-inbox-files-failed="">
          <ErrorState
            onRetry={() => {
              for (const file of failed) onRetryImage(file.attachmentId);
            }}
          >
            {FILES_FAILED_LINE}
          </ErrorState>
        </div>
      )}
    </>
  );
}

/** No files, one array so a comment that has none hands down the same one. */
const NO_FILES: NonNullable<InboxItem["answerFiles"]> = [];

/**
 * A form's values as a member filled them, one a line in the form's order:
 * each field's name, then what was put in it, a text field's words drawn as
 * the agent's tab draws a sent message, so a mention they hold is its chip,
 * and any other field's value in its words, "yes" or "no" for a yes or no.
 */
function AnswerValues({
  values,
  texts,
}: {
  values: readonly InboxFormValue[];
  /** The labels of the form's text fields. */
  texts: ReadonlySet<string>;
}): React.JSX.Element | null {
  if (values.length === 0) return null;
  return (
    <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.TIGHT} className="inbox-values" data-inbox-values="">
      {values.map(({ label, value }) => (
        <li key={label} className="inbox-value">
          <span className="inbox-value-label">{label}</span>
          <div className="inbox-words inbox-value-words">
            {texts.has(label) && isWireString(value) ? (
              <SentWords text={value} />
            ) : (
              fieldValueWords(value)
            )}
          </div>
        </li>
      ))}
    </Stack>
  );
}

/**
 * The developer's answer as their comment: who answered, by their face and
 * name, when, and where it went, then what they picked as a chip, where
 * the question does not draw it picked already, a form's values where it
 * does not draw them in its fields (one of a response this build does not
 * know), what they wrote, and the files they attached after it.
 */
function Answered({
  item,
  by,
  now,
  images,
  onImage,
  onRetryImage,
}: {
  item: InboxItem;
  by: ItemAgent;
  now: number;
  images: TaskInboxControl["images"];
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
}): React.JSX.Element | null {
  const answerer = usePerson(item.answeredBy);
  const settled = settlementOf(item);
  if (settled === undefined) return null;
  if (settled.by !== SETTLED_BY.DEVELOPER) return null;
  // Files alone are the developer's own words where they wrote none, so no "Answered it" chip stands over them.
  const filesSay =
    (item.answerFiles ?? []).length > 0 && item.answer?.reply === INBOX_REPLY.ANSWERED
      ? ""
      : undefined;
  const drawn = drawsAnswered(item);
  const pick = pickOf(item, settled.did, settled.values ?? settled.note ?? filesSay, drawn);
  return (
    <Comment
      kind={COMMENT.ANSWERED}
      head={
        <>
          <CommentName>
            <ActorRef actor={answerer} />
          </CommentName>
          <span className="inbox-comment-when">
            <Time className={THREAD_TIME_CLASS} at={settledAt(item) ?? item.updatedAt} now={now} />{" "}
            · <Delivered item={item} by={by} />
          </span>
        </>
      }
    >
      <AnsweredResponse item={item} />
      {pick === undefined ? null : (
        <span className="inbox-pick" data-inbox-pick="">
          <CheckIcon aria-hidden="true" />
          <span>{pick}</span>
        </span>
      )}
      {/* The values stand in the question's own fields where it draws them; a response this build does not know lists them here. */}
      {settled.values === undefined || drawn ? null : (
        <AnswerValues values={item.answer?.values ?? []} texts={NO_TEXT_LABELS} />
      )}
      <CommentFiles
        itemId={item.id}
        files={item.answerFiles ?? NO_FILES}
        words={settled.note}
        images={images}
        onImage={onImage}
        onRetryImage={onRetryImage}
      />
      {/* The note is drawn as the agent's tab draws a message, so a mention it holds is its chip. */}
      {settled.note === undefined ? null : (
        <div className="inbox-words" data-inbox-note="">
          <SentWords text={settled.note} asDocument />
        </div>
      )}
    </Comment>
  );
}

/** The agent taking an item back, as one more comment of its own: when, and why where it said. */
function Withdrawn({
  item,
  by,
  now,
}: {
  item: InboxItem;
  by: ItemAgent;
  now: number;
}): React.JSX.Element | null {
  const settled = settlementOf(item);
  if (settled?.by !== SETTLED_BY.AGENT) return null;
  return (
    <Comment
      kind={COMMENT.WITHDRAWN}
      head={
        <>
          <CommentName>
            <AgentName by={by} />
          </CommentName>
          <span className="inbox-comment-when">
            withdrew this{" "}
            <Time className={THREAD_TIME_CLASS} at={settledAt(item) ?? item.updatedAt} now={now} />
          </span>
        </>
      }
    >
      {settled.words === undefined ? undefined : (
        <p className="inbox-words" {...{ [REPLY_SCOPE]: "" }}>
          {settled.words}
        </p>
      )}
    </Comment>
  );
}

/** A member closing an item without an answer, as one more comment of theirs: who, when, and whether the agent was told. */
function Closed({
  item,
  by,
  now,
}: {
  item: InboxItem;
  by: ItemAgent;
  now: number;
}): React.JSX.Element | null {
  const closer = usePerson(item.closedBy);
  if (settlementOf(item)?.by !== SETTLED_BY.CLOSER) return null;
  return (
    <Comment
      kind={COMMENT.CLOSED}
      head={
        <>
          <CommentName>
            <ActorRef actor={closer} />
          </CommentName>
          <span className="inbox-comment-when">
            <Time className={THREAD_TIME_CLASS} at={settledAt(item) ?? item.updatedAt} now={now} />{" "}
            · <Delivered item={item} by={by} />
          </span>
        </>
      }
    >
      <span className="inbox-pick" data-inbox-pick="">
        <CircleSlashIcon aria-hidden="true" />
        <span>{CLOSED_WORDS}</span>
      </span>
    </Comment>
  );
}

/**
 * One message on the thread as its writer's comment: a member by their
 * face and name, "You" for the reader's own, someone unnamed where their
 * account is gone; the agent by its tile and name, as its question is.
 * Its words are drawn as the agent's tab draws a sent message, its mentions
 * chips, then the files it carried, as an answer's are; a message of files
 * alone draws them alone.
 */
function Message({
  item,
  message,
  by,
  now,
  images,
  onImage,
  onRetryImage,
}: {
  item: InboxItem;
  message: InboxMessage;
  by: ItemAgent;
  now: number;
  images: TaskInboxControl["images"];
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
}): React.JSX.Element {
  const member = usePerson(message.member);
  const fromAgent = message.author === INBOX_MESSAGE_AUTHOR.AGENT;
  return (
    <Comment
      kind={COMMENT.MESSAGE}
      messageId={message.id}
      head={
        <>
          <CommentName>
            {fromAgent ? <AgentName by={by} /> : <ActorRef actor={member} />}
          </CommentName>
          <span className="inbox-comment-when">
            <Time className={THREAD_TIME_CLASS} at={message.createdAt} now={now} />
          </span>
        </>
      }
    >
      <CommentFiles
        itemId={item.id}
        files={message.files ?? NO_FILES}
        words={message.text}
        images={images}
        onImage={onImage}
        onRetryImage={onRetryImage}
      />
      {message.text === "" ? null : (
        <div
          className="inbox-words"
          data-inbox-message-text=""
          // The agent's words alone may be replied to, as in its tab, never a member's.
          {...(fromAgent ? { [REPLY_SCOPE]: "" } : {})}
        >
          <SentWords text={message.text} asDocument />
        </div>
      )}
    </Comment>
  );
}

/** Where a thread read carries only its latest messages: a line saying the earlier ones stand in the agent's tab, the agent's name opening it. */
function EarlierMessages({ by }: { by: ItemAgent }): React.JSX.Element {
  return (
    <li className="inbox-thread-earlier" data-inbox-earlier="">
      <ActorLine>
        {"Earlier messages are in "}
        <AgentName by={by} />
        {"’s tab"}
      </ActorLine>
    </li>
  );
}

/**
 * What follows the question, in the order it was written: the thread's
 * messages, and where it was settled, the answer or the agent taking it
 * back; a line first where the thread read carries only its latest
 * messages.
 */
function ThreadAfter({
  item,
  by,
  now,
  control,
}: {
  item: InboxItem;
  by: ItemAgent;
  now: number;
  control: TaskInboxControl;
}): React.JSX.Element {
  const { images, onImage, onRetryImage } = control;
  return (
    <>
      {threadCut(item) ? <EarlierMessages by={by} /> : null}
      {threadEntries(item).map((entry) =>
        entry.kind === THREAD_ENTRY.SETTLED ? (
          <SettledComments
            key="settled"
            item={item}
            by={by}
            now={now}
            images={images}
            onImage={onImage}
            onRetryImage={onRetryImage}
          />
        ) : (
          <Message
            key={entry.message.id}
            item={item}
            message={entry.message}
            by={by}
            now={now}
            images={images}
            onImage={onImage}
            onRetryImage={onRetryImage}
          />
        ),
      )}
    </>
  );
}

/** The comment a settled item was settled by: the developer's answer, the agent taking it back, or a member closing it. */
function SettledComments({
  item,
  by,
  now,
  images,
  onImage,
  onRetryImage,
}: {
  item: InboxItem;
  by: ItemAgent;
  now: number;
  images: TaskInboxControl["images"];
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
}): React.JSX.Element {
  return (
    <>
      <Answered
        item={item}
        by={by}
        now={now}
        images={images}
        onImage={onImage}
        onRetryImage={onRetryImage}
      />
      <Withdrawn item={item} by={by} now={now} />
      <Closed item={item} by={by} now={now} />
    </>
  );
}

/** The reader's draft reply at the thread's end, where the box stands. */
function draftReplyOf(scroller: HTMLElement): Element | null {
  return scroller.querySelector('[data-inbox-comment="draft"]');
}

/** How far the scroller's foot stands in from its edge: its scroll padding, which clears the fade over it. */
function footPadding(scroller: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(scroller).scrollPaddingBottom) || 0;
}

/**
 * Scrolls the board to a message of the reader's own the moment it lands
 * on the thread, inside the board's own scroller, since the pane may still
 * be sliding in (`AGENTS.md`'s panel motion): far enough that the draft
 * reply under it, the box written in again, stands whole over the board's
 * foot, and no further than the message's head. A message another wrote,
 * or another item opened, scrolls nothing. Note that a reader already at
 * the thread's end is kept there by the log itself (`Conversation`), whose
 * observer has the last word once the thread's new height is reported, so
 * this is what brings the message in for a reader scrolled up, whom the
 * log leaves where they are; the two never pull different ways for long,
 * since a scroll that lands at the end hands the thread back to the log.
 */
function useScrollToOwnMessage(
  board: React.RefObject<HTMLDivElement | null>,
  item: InboxItem,
  readerId: string | undefined,
): void {
  const last = (inboxThreadOf(item) ?? item.messages)?.at(-1);
  const own =
    last !== undefined &&
    last.author === INBOX_MESSAGE_AUTHOR.MEMBER &&
    readerId !== undefined &&
    last.member?.userId === readerId;
  const seen = useRef({ itemId: item.id, lastId: last?.id });
  useLayoutEffect(() => {
    const was = seen.current;
    seen.current = { itemId: item.id, lastId: last?.id };
    const scroller = board.current;
    if (!own || scroller === null || was.itemId !== item.id || was.lastId === last?.id) return;
    const comment = scroller.querySelector(`[data-message-id="${CSS.escape(last.id)}"]`);
    if (comment === null) return;
    const room = scroller.getBoundingClientRect();
    const head = comment.getBoundingClientRect().top;
    const foot = (draftReplyOf(scroller) ?? comment).getBoundingClientRect().bottom;
    const under = foot - (room.bottom - footPadding(scroller));
    if (under > 0) scroller.scrollTop += Math.min(under, head - room.top);
  }, [board, item.id, last, own]);
}

/** What an ask's box says where its type is one this build does not know. */
const NEWER_LUKE_ASK = "Answer this in a newer Luke.";

/**
 * Who an open ask waits on where that is a teammate (`inboxWaitsOn`): its
 * task's assignee, else the one who started its agent, in the muted ink, as the list's Waiting on others does,
 * though any member may still answer. Where the item is the reader's
 * (`readersItem`) it draws nothing: the draft reply under the thread,
 * holding the ask's controls, already says the answer is theirs.
 */
function Waiting({ on }: { on: InboxItem["startedBy"] }): React.JSX.Element | null {
  const starter = usePerson(on);
  if (on === undefined) return null;
  return (
    <span className="inbox-waiting-on" data-inbox-waiting="">
      Waiting on {actorName(starter, { sentence: true })}
    </span>
  );
}

/**
 * What ends an agent's message whose ask was replaced: by a newer question
 * where a later message of the agent's on the thread asks one, and by a
 * newer message otherwise, as a post that asks nothing from before
 * version 5 replaces the ask it posts over.
 */
const REPLACED = {
  BY_QUESTION: "Replaced by a newer question",
  BY_MESSAGE: "Replaced by a newer message",
} as const;

/**
 * What ends an agent's message whose ask of words alone was answered, where
 * the thread read carries the reply: a small pill saying "Answered", with
 * no card, the reply's words being the answer.
 */
function AnsweredMarker(): React.JSX.Element {
  return (
    <span data-inbox-settled="answered">
      <Badge tone={BADGE_TONE.COMPLETE} icon={<CheckIcon aria-hidden="true" />}>
        {ANSWERED}
      </Badge>
    </span>
  );
}

/**
 * What ends an agent's message whose ask was replaced or withdrawn: its
 * controls as it offered them (`HeldControls`), stepped back to the muted
 * ink (`SteppedBack`), nothing picked and taking nothing, so what it used to
 * ask still reads in the thread and never as an answer, then `marker`, the
 * small pill saying what became of it. An `answer` of words
 * alone, which has no controls, ends with the pill alone, as does a to-do
 * naming no steps, whose one step was the item's title as it stood then,
 * which a later post may have renamed.
 */
function HeldAsk({
  ask,
  title,
  marker,
}: {
  ask: InboxKnownAsk;
  /** The item's title, which stands as the one step of a to-do that names none. */
  title: string;
  marker: React.JSX.Element;
}): React.JSX.Element {
  // A to-do naming no steps draws the item's title as its one step, and a later post may have renamed the item since, so the title it drew then is not known.
  if (!hasControls(ask) || (ask.type === INBOX_ASK.DO && ask.steps.length === 0)) return marker;
  return (
    <div className="inbox-ask-replaced" data-inbox-replaced="">
      <div className="inbox-ask-replaced-controls" aria-disabled="true">
        <SteppedBack>
          <HeldControls ask={ask} title={title} draft={EMPTY_INBOX_DRAFT} />
        </SteppedBack>
      </div>
      {marker}
    </div>
  );
}

/**
 * The pill ending a replaced ask's message: a newer question replaced it
 * where a later message of the agent's on the thread asks one, and a newer
 * message otherwise.
 */
function ReplacedMarker({
  message,
  thread,
}: {
  message: InboxMessage;
  thread: readonly InboxMessage[];
}): React.JSX.Element {
  const at = thread.findIndex((said) => said.id === message.id);
  const asked = thread
    .slice(at + 1)
    .some((said) => said.author === INBOX_MESSAGE_AUTHOR.AGENT && said.ask !== undefined);
  return (
    <span data-inbox-settled="replaced">
      <Badge>{asked ? REPLACED.BY_QUESTION : REPLACED.BY_MESSAGE}</Badge>
    </span>
  );
}

/**
 * What ends a withdrawn ask's message: the pill saying it was withdrawn, or
 * who closed the item without answering while the close stands, and why its
 * agent took it back as a muted sentence under the pill, so a long why
 * reads as words rather than wrapping inside it.
 */
function WithdrawnMarker({
  item,
  reason,
}: {
  item: InboxItem;
  reason: string | undefined;
}): React.JSX.Element {
  const closer = usePerson(item.closedBy);
  return (
    <div className="inbox-ask-withdrawn" data-inbox-settled="withdrawn">
      <Badge>
        <WithdrawnWords reason={reason} closer={item.closedBy === undefined ? undefined : closer} />
      </Badge>
      <WithdrawnWhy reason={reason} />
    </div>
  );
}

/**
 * The small pill that ends the agent's message while what it asks waits on
 * a teammate: "Waiting on" them, after a dot in the muted ink. Where it
 * waits on the reader it draws nothing, the draft reply at the thread's
 * end (`DraftReply`) holding its controls saying so already.
 */
function AskMarker({ on }: { on: InboxItem["startedBy"] }): React.JSX.Element | null {
  const starter = usePerson(on);
  if (on === undefined) return null;
  return <WaitingMarker on={actorName(starter, { sentence: true })} />;
}

/**
 * The box closing a message that asks: while it waits, a marker alone
 * saying which teammate it waits on (`AskMarker`), or nothing where it
 * waits on the reader, its controls standing in the draft reply; once answered, nothing, the card standing at the head
 * of the reply that answered it (`AnsweredCard`), or, for an ask of words
 * alone, which draws no card, a small "Answered" marker (`AnsweredMarker`);
 * a card saying
 * "Answered" alone where the thread read no longer carries that reply; for
 * a replaced ask, no card, its controls as it offered them, stepped back,
 * over a small marker saying a newer question, or message, replaced it
 * (`HeldAsk`); for a withdrawn one the same, over a marker saying so and
 * why, or who closed the item; and an ask this build does not know a card naming a
 * newer Luke.
 */
function AskBox({
  item,
  message,
  ask,
  thread,
  waitingOn,
}: {
  item: InboxItem;
  message: InboxMessage;
  ask: InboxReadAsk;
  thread: readonly InboxMessage[];
  /** The teammate the ask waits on while open; none where it waits on the reader. */
  waitingOn: InboxItem["startedBy"];
}): React.JSX.Element | null {
  if (!knownAsk(ask)) {
    return (
      <div className="inbox-ask" data-inbox-ask="newer">
        <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.FLUSH}>
          <CardHead>
            <Text tone={TEXT_TONE.MUTED}>{NEWER_LUKE_ASK}</Text>
            {ask.status === INBOX_ASK_STATUS.OPEN ? <Waiting on={waitingOn} /> : null}
          </CardHead>
        </Card>
      </div>
    );
  }
  if (ask.status === INBOX_ASK_STATUS.REPLACED) {
    return (
      <HeldAsk
        ask={ask}
        title={cardTitle(item.title)}
        marker={<ReplacedMarker message={message} thread={thread} />}
      />
    );
  }
  if (ask.status === INBOX_ASK_STATUS.WITHDRAWN) {
    return (
      <HeldAsk
        ask={ask}
        title={cardTitle(item.title)}
        marker={<WithdrawnMarker item={item} reason={ask.withdrawnReason} />}
      />
    );
  }
  if (ask.status === INBOX_ASK_STATUS.OPEN) {
    return <AskMarker on={waitingOn} />;
  }
  // The card goes with the reply that answered it, wherever the thread read still carries that reply.
  const answered = ask.status === INBOX_ASK_STATUS.ANSWERED;
  if (answered && answerOf(thread, message.id)?.answers !== undefined) {
    // An answer of words alone draws no card, so its marker says here that it was answered.
    return ask.type === INBOX_ASK.ANSWER && ask.fields === undefined ? <AnsweredMarker /> : null;
  }
  return (
    <div className="inbox-ask" data-inbox-ask={ask.status}>
      <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.FLUSH}>
        <CardHead>
          <span className="inbox-ask-kind">{askHeadWords(ask, undefined)}</span>
          <span className="inbox-ask-standing">{ANSWERED}</span>
        </CardHead>
      </Card>
    </div>
  );
}

/** The ask a message's answer answers, where the thread read still carries it. */
function answeredAsk(
  thread: readonly InboxMessage[],
  answers: InboxAnswers,
): InboxReadAsk | undefined {
  return thread.find((message) => message.id === answers.ask)?.ask;
}

/** No text fields' labels, for values whose ask or response this build cannot read, so none is known to be a text field. */
const NO_TEXT_LABELS: ReadonlySet<string> = new Set();

/**
 * One message of a thread from version 5, a Markdown document, as its
 * writer's comment: a member by their face and name, the agent by its tile
 * and name and a quiet "agent" after it, then when. An answer leads with
 * the card of the ask it answered, filled in as it was answered
 * (`AnsweredCard`), or, where the thread read no longer carries that ask,
 * its stamp and its values listed; then its words, the agent's drawn as its
 * question's are and a member's as a sent message's, and the files it
 * carried after them, a picture its words draw standing there alone;
 * an agent's message that asks ends with its ask's box, a marker alone
 * while it waits, until it is answered.
 */
function ThreadMessage({
  item,
  message,
  thread,
  by,
  now,
  control,
  waitingOn,
}: {
  item: InboxItem;
  message: InboxMessage;
  thread: readonly InboxMessage[];
  by: ItemAgent;
  now: number;
  control: TaskInboxControl;
  waitingOn: InboxItem["startedBy"];
}): React.JSX.Element {
  const member = usePerson(message.member);
  const fromAgent = message.author === INBOX_MESSAGE_AUTHOR.AGENT;
  const answers = message.answers;
  const answered = answers === undefined ? undefined : answeredAsk(thread, answers);
  return (
    <Comment
      kind={COMMENT.MESSAGE}
      messageId={message.id}
      head={
        <>
          <CommentName>
            {fromAgent ? <AgentName by={by} /> : <ActorRef actor={member} />}
          </CommentName>
          <span className="inbox-comment-when">
            <Time className={THREAD_TIME_CLASS} at={message.createdAt} now={now} />
          </span>
        </>
      }
    >
      {answers === undefined ? null : answered !== undefined && knownAsk(answered) ? (
        <AnsweredCard ask={answered} title={cardTitle(item.title)} answers={answers} />
      ) : (
        <>
          {/* Where the thread read no longer carries the ask, or this build does not know it, the answer is its stamp and its values listed. */}
          <InboxStamp stamp={sentStamp(answers, answered)} />
          <AnswerValues values={answers.values ?? []} texts={NO_TEXT_LABELS} />
        </>
      )}
      <CommentFiles
        itemId={item.id}
        files={message.files ?? NO_FILES}
        words={message.text}
        images={control.images}
        onImage={control.onImage}
        onRetryImage={control.onRetryImage}
      />
      {message.text === "" ? null : (
        <div
          className="inbox-words inbox-message-words"
          data-inbox-message-text=""
          // The agent's words alone may be replied to, as in its tab, never a member's.
          {...(fromAgent ? { [REPLY_SCOPE]: "" } : {})}
        >
          {fromAgent ? (
            <TranscriptWords text={message.text} asDocument />
          ) : (
            <SentWords text={message.text} asDocument />
          )}
        </div>
      )}
      {message.ask === undefined ? null : (
        <AskBox
          item={item}
          message={message}
          ask={message.ask}
          thread={thread}
          waitingOn={waitingOn}
        />
      )}
    </Comment>
  );
}

/** What the pane's ⋯ menu is called, which is its tooltip too. */
const ITEM_MENU_LABEL = "Item actions";

/**
 * The item's ⋯ menu at the end of the pane's bar, as an issue's page and an
 * agent's tab end theirs: Mark as read or unread, naming U, as the item's
 * row's menu does; Copy link, the item's link under its task or its agent; and, while the item is open, Close
 * without answering, asked first (`inbox-close.tsx`). It is keyed by its
 * item where it is drawn, so a question asked on one item never closes the
 * next, and the menu and the question go with the pane once it is hidden.
 */
function InboxItemMenu({
  holder,
  item,
  shown,
  onMark,
  onClose,
}: {
  holder: InboxHolder;
  item: InboxItem;
  shown: boolean;
  onMark: InboxPaneDoors["onMark"];
  onClose: InboxCloser | undefined;
}): React.JSX.Element | null {
  const menu = useMenu(shown);
  const read: MenuAction | undefined =
    onMark === undefined
      ? undefined
      : {
          ...markReadItem({ unread: isUnread(item), onMark: (unread) => onMark(item, unread) }),
          command: APP_COMMAND.TOGGLE_INBOX_ITEM_READ,
        };
  const copyLink = useCopyLinkItem()(
    holder.kind === INBOX_HOLDER.TASK
      ? { kind: LINK_PLACE.INBOX_ITEM, planId: holder.task.id, itemId: item.id }
      : { kind: LINK_PLACE.INBOX_ITEM, agentId: item.agentId, itemId: item.id },
  );
  const close = useInboxClose(item, onClose, shown);
  const groups = [
    read === undefined ? [] : [read],
    copyLink === undefined ? [] : [copyLink],
    close.action === undefined ? [] : [close.action],
  ].filter((group) => group.length > 0);
  if (groups.length === 0) return null;
  return (
    <>
      <Tooltip label={ITEM_MENU_LABEL}>
        <IconButton icon={<EllipsisIcon />} label={ITEM_MENU_LABEL} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={ITEM_MENU_LABEL}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
      {close.dialog}
    </>
  );
}

/**
 * The thread's subject, as a plan or a pull request leads with one: the
 * item's title alone, the thread under it.
 */
function Subject({
  item,
  heading,
}: {
  item: InboxItem;
  /** Takes the title's heading, which the bar watches scroll away (`useHeadingAway`). */
  heading: (element: HTMLElement | null) => void;
}): React.JSX.Element {
  return (
    <header className="inbox-subject">
      <h2 ref={heading} className="inbox-subject-title" data-inbox-title="">
        {cardTitle(item.title)}
      </h2>
    </header>
  );
}

/**
 * Whether the item's heading has scrolled up out of the thread's view, as
 * the thread's scroller reports it, so the bar names the item in its place.
 * Note that a heading the pane does not draw, its list standing alone in its
 * place, has not scrolled away, and that another item opens with its own
 * heading in view until its scroller says otherwise.
 */
function useHeadingAway(
  board: React.RefObject<HTMLElement | null>,
  heading: HTMLElement | null,
  itemId: string,
): boolean {
  const [away, setAway] = useState<{ readonly itemId: string; readonly away: boolean }>({
    itemId,
    away: false,
  });
  useEffect(() => {
    const scroller = board.current;
    if (scroller === null || heading === null || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const seen = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry === undefined) return;
        const top = entry.rootBounds?.top ?? 0;
        setAway({
          itemId,
          away: !entry.isIntersecting && entry.boundingClientRect.bottom <= top,
        });
      },
      { root: scroller },
    );
    seen.observe(heading);
    return () => seen.disconnect();
  }, [board, heading, itemId]);
  return away.itemId === itemId && away.away;
}

/** The box's mentions where the pane is handed them; the page's own where it is not. */
function AnswerMentions({
  value,
  children,
}: {
  value: TaskMentionsValue | undefined;
  children: React.ReactNode;
}): React.ReactNode {
  return value === undefined ? children : <TaskMentions value={value}>{children}</TaskMentions>;
}

/** The words a dictation into an item's box is likely to say: its repository's, its title's, and the paths its blocks name. */
function answerKeywords(holder: InboxHolder, item: InboxItem): readonly string[] {
  const repository =
    holder.kind === INBOX_HOLDER.TASK ? holder.task.repository : holder.repository || null;
  const blocks = item.blocks.flatMap((block) => {
    if (!knownBlock(block)) return [];
    if (block.type === INBOX_BLOCK.MARKDOWN) return [block.text];
    return block.type === INBOX_BLOCK.CODE ? [block.path] : [];
  });
  const said = (inboxThreadOf(item) ?? []).map((message) => message.text);
  const body = [...blocks, ...said].join("\n");
  return dictationKeywords({ repository, title: item.title, body });
}

/** What the pane's crumbs open, and the cards they hang. */
export interface InboxPaneDoors {
  /** Opens what holds the item: its task, or its automation's page; nothing where there is none to open. */
  readonly onOpenHolder: (() => void) | undefined;
  /** The task's hover card, as its sidebar row hangs it; none for an automation. */
  readonly taskCard: React.ReactNode;
  /** Opens the agent's tab on its task. */
  readonly onOpenAgent: (agentId: string) => void;
  /** Opens a link block's web page in the browser (`use-open-link.ts`). */
  readonly openLink: (url: string) => void;
  readonly code: InboxCodeDoors;
  /** Marks the item read or unread, from the bar's ⋯ menu; none where the pane offers no mark. */
  readonly onMark?: ((item: InboxItem, unread: boolean) => void) | undefined;
  /** Closes an open item without an answer, from the bar's ⋯ menu; none where the pane offers no close. */
  readonly onClose?: InboxCloser | undefined;
}

/**
 * An automation's crumb, as its page's own look names it: its clock and its
 * name, hanging its card where the window reads it, and opening its page
 * where that can be opened.
 */
function useAutomationCrumb(
  holder: InboxHolder,
  onOpen: (() => void) | undefined,
): Crumb | undefined {
  const automationId = holder.kind === INBOX_HOLDER.AUTOMATION ? holder.automationId : null;
  const known = useAutomation(automationId ?? undefined);
  if (holder.kind !== INBOX_HOLDER.AUTOMATION) return undefined;
  return {
    label: holder.name,
    // Note that the agents no automation names stand under no automation, so their crumb wears the factory glyph, as their group's header does.
    glyph: holder.automationId === null ? <FactoryIcon /> : <ClockIcon />,
    hint: holder.name,
    card:
      known === undefined ? undefined : (
        <AutomationCard automation={known.automation} workspaceName={known.workspaceName} />
      ),
    onPress: onOpen === undefined ? undefined : () => onOpen(),
  };
}

/**
 * The pane's path, task › agent, each crumb wearing its tab's glyph in the
 * task's column, the task's document glyph and the agent's mark: each opens
 * what it names, the task or the agent's tab, and hangs the card its
 * sidebar row or tab hangs. An agent with no task stands under the
 * automation that started it instead, by its clock and name, which hang its
 * card and open the automation's page where that can be opened, and are
 * words alone where it cannot. An agent this window does not list, one
 * started on another Mac, hangs a card saying so and still opens its tab.
 * Once the thread's heading has scrolled away, the item's title joins the
 * path as its last words, in the text's own ink, so the bar still says what
 * is read; it fades in as it comes and out as the heading comes back, so the
 * title never stands twice. A narrow bar cuts the task's crumb short first,
 * then the title, which ends in an ellipsis, and the agent's keeps its size.
 */
function Crumbs({
  holder,
  by,
  doors,
  title,
  titleShown,
}: {
  holder: InboxHolder;
  by: ItemAgent;
  doors: InboxPaneDoors;
  /** The item's title, as its heading reads it. */
  title: string;
  /** Whether the heading has scrolled away, so the path names the item. */
  titleShown: boolean;
}): React.JSX.Element {
  const { name, agent } = by.subject;
  const automation = useAutomationCrumb(holder, doors.onOpenHolder);
  const onOpenHolder = doors.onOpenHolder;
  const task: Crumb | undefined =
    holder.kind === INBOX_HOLDER.TASK
      ? {
          label: holder.task.name,
          glyph: tabLook({
            kind: TAB_KIND.PLAN,
            name: holder.task.name,
            status: holder.task.status,
          }).icon,
          hint: holder.task.name,
          card: doors.taskCard,
          onPress: () => onOpenHolder?.(),
        }
      : undefined;
  const crumbs: Crumb[] = [
    task ?? automation,
    {
      label: name,
      glyph: tabLook({ kind: TAB_KIND.AGENT, name, agent }).icon,
      hint: name,
      card: <AgentCard subject={by.subject} models={by.models} />,
      onPress: () => by.onOpen(),
      // Note that once the title joins the path the agent's crumb keeps its size, so a narrow bar cuts the task's crumb short first and then the title.
      fixed: titleShown,
    },
    { label: title, current: true, shown: titleShown, end: ONE_LINE_END.ELLIPSIS },
  ].filter((crumb) => crumb !== undefined);
  return (
    <div className="inbox-crumbs">
      <Breadcrumbs label="Path" crumbs={crumbs} />
    </div>
  );
}

/**
 * One item at reading size, as a comment thread: under the pane's crumbs,
 * the item's title alone as the thread's subject; then the agent's question as the first comment, its
 * blocks and what it offers, and what came of it as the comments after.
 * While the item waits, a choice's options and a form's fields are pressed
 * in the question, and the box is docked at the pane's foot. Once it is
 * settled, the options fold to one line saying who picked which, and the
 * developer's answer follows as their comment, when and whether it reached
 * the agent, their pick as a chip over their words; or the agent's own
 * comment says it took the item back, and why; the thread's messages
 * stand among them by when they were written; and over the box, which now
 * writes a message on the thread, the next item that needs the developer
 * is offered (`inbox-pager.tsx`).
 * Where the item stands alone, the whole Inbox wide, the crumbs follow a
 * way back to the list (`inbox-columns.ts`), its tooltip naming Back's
 * chord, which goes back as Escape does, and the bar ends in the pager,
 * "2 of 8" and the arrows up and down the list (`inbox-pager.tsx`).
 */
export function InboxPane({
  holder,
  item,
  control,
  agents,
  doors,
  hidden,
  onBack,
  pager,
  next,
  mentions,
}: {
  /** What holds the item: its task, or the automation that started its agent with no task. */
  holder: InboxHolder;
  item: InboxItem;
  /** The live read of the item's task, or of its agent with no task, which answers it and holds its draft. */
  control: TaskInboxControl;
  agents: CodingAgentsControl;
  doors: InboxPaneDoors;
  /** Whether the list stands alone in the item's place. */
  hidden: boolean;
  /** Goes back to the list, where the item stands alone. */
  onBack: (() => void) | undefined;
  /** Where the item stands in the list and the steps either side, drawn at the bar's end where the item stands alone among others. */
  pager: InboxPager | undefined;
  /** The next item that needs the developer, offered over the box once the item is settled. */
  next: InboxNext | undefined;
  /** What the box's `@` offers where the page around the pane hands nothing, as the window's Inbox does; the page's own otherwise. */
  mentions?: TaskMentionsValue | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const board = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const directory = useMemberDirectory();
  const readerId = directory.readerId ?? agents.me;
  useScrollToOwnMessage(board, item, readerId);
  const [heading, setHeading] = useState<HTMLElement | null>(null);
  const headingAway = useHeadingAway(board, heading, item.id);
  // An open ask waits on its task's assignee, else whoever started its agent, as the list says, though any member may answer it.
  const waitingOn = readersItem(item, readerId) ? undefined : inboxWaitsOn(item);
  const by: ItemAgent = {
    subject: agentSubject(agents, item.agentId, NOTHING_HELD, false),
    models: agents.models,
    onOpen: () => doors.onOpenAgent(item.agentId),
  };
  const open = item.status === INBOX_STATUS.OPEN;
  const draft = control.draftOf(item);
  // Note that an item from version 5 is drawn as its thread, and one from before as it always was.
  const thread = inboxThreadOf(item);
  useOptionNumbers(pane, item, draft, control, open ? numberedPickOf(item, thread) : undefined);
  const formText: FormTextDoors = {
    self: item.agentId,
    agent: by.subject.agent,
    skills: agents.readSkills,
    keywords: answerKeywords(holder, item),
    onEnter: () => sendFromPane(pane.current),
  };
  // Note that the item's words are read under its own workspace, its plan's or its agent's, never the one the Inbox lists, which may not be the item's.
  const workspaceId = itemWorkspaceId(holder, item.agentId);
  const cardDoors = useMemo(() => ({ code: doors.code }), [doors.code]);
  const onDraft = (next: InboxDraft) => control.onDraft(item, next);
  // The open question's controls stand in the draft reply, over its note: a thread's open ask's, or an older item's response's.
  const asking = thread === undefined ? undefined : openAskOf(thread);
  const openAsk = asking !== undefined && knownAsk(asking.ask) ? asking.ask : undefined;
  // Note that an ask of words alone has no controls, so the box stands plain and its words answer it.
  const wordsAlone = openAsk?.type === INBOX_ASK.ANSWER && openAsk.fields === undefined;
  // Note that a note asks nothing back but a nod, so it waits on no one's answer and wears no marker.
  const marked = knownResponse(item.response) && item.response.type !== INBOX_RESPONSE.NONE;
  const question =
    thread === undefined ? (
      open && drawsControls(item) ? (
        <DraftQuestion pane={pane}>
          <ResponseControls
            item={item}
            draft={draft}
            disabled={!open}
            text={formText}
            onDraft={onDraft}
          />
        </DraftQuestion>
      ) : undefined
    ) : openAsk === undefined || wordsAlone ? undefined : (
      <DraftQuestion pane={pane}>
        <AskControls
          ask={openAsk}
          title={cardTitle(item.title)}
          doors={{ draft, disabled: !open, text: formText, onDraft }}
        />
      </DraftQuestion>
    );
  // The box stands at the thread's end as the reader's draft reply.
  const draftReply = (
    <AnswerMentions value={mentions}>
      <DraftReply readerId={readerId}>
        <InboxAnswerBox
          item={item}
          readerId={readerId}
          control={control}
          agent={by.subject.agent}
          thread={thread}
          controls={question}
          skills={agents.readSkills}
          keywords={answerKeywords(holder, item)}
          replyScope={board}
          onMissing={(missing) => focusMissing(pane.current, missing)}
          onUnarchiveAgent={() => agents.onArchive(item.agentId, false)}
        />
      </DraftReply>
    </AnswerMentions>
  );
  return (
    <section
      ref={pane}
      className="inbox-view-items"
      aria-label={cardTitle(item.title)}
      hidden={hidden}
    >
      <header className="desktop-toolbar">
        {onBack === undefined ? null : (
          <FoldingButton label="Inbox" icon={<BackIcon />} onClick={onBack} hint={BackHint} />
        )}
        <Crumbs
          holder={holder}
          by={by}
          doors={doors}
          title={cardTitle(item.title)}
          titleShown={headingAway}
        />
        {/* The bar ends in the pager, where the item stands alone, and the item's ⋯ menu. */}
        <div className="desktop-toolbar-actions inbox-item-actions">
          {pager === undefined ||
          (pager.onPrevious === undefined && pager.onNext === undefined) ? null : (
            <InboxPagerControls pager={pager} />
          )}
          <InboxItemMenu
            key={item.id}
            holder={holder}
            item={item}
            shown={!hidden}
            onMark={doors.onMark}
            onClose={doors.onClose}
          />
        </div>
      </header>
      <Fill className="desktop-inbox">
        {/* The thread is a log as an agent's transcript is: each item opens at its newest message, the box at its end, and keeps to it while the reader is there; scrolled up, the way back floats over its foot. */}
        <Conversation subject={item.id} list={board}>
          <ConversationContent className="inbox-board agent-log-over-composer ph-no-capture">
            <WordsWorkspace value={workspaceId}>
              {/* The item's words are drawn as documents: its own pictures read through the Inbox, and a link alone on its line as its card. */}
              <InboxPictures itemId={item.id} control={control}>
                <LoneLinkCards doors={cardDoors}>
                  {thread === undefined ? (
                    <>
                      <Subject item={item} heading={setHeading} />
                      <Stack
                        as={LAYOUT_ELEMENT.OL}
                        gap={GAP.NONE}
                        className="inbox-thread"
                        aria-label="Thread"
                      >
                        <Comment
                          kind={COMMENT.ASKED}
                          head={
                            <>
                              <CommentName>
                                <AgentName by={by} />
                              </CommentName>
                              <span className="inbox-comment-when">
                                <Time className={THREAD_TIME_CLASS} at={item.postedAt} now={now} />
                              </span>
                            </>
                          }
                        >
                          <Blocks item={item} openLink={doors.openLink} code={doors.code} />
                          {!open ? (
                            <SettledResponse item={item} />
                          ) : marked ? (
                            <AskMarker on={waitingOn} />
                          ) : null}
                        </Comment>
                        <ThreadAfter item={item} by={by} now={now} control={control} />
                        {draftReply}
                      </Stack>
                    </>
                  ) : (
                    <>
                      <Subject item={item} heading={setHeading} />
                      <AnswerMentions value={mentions}>
                        <Stack
                          as={LAYOUT_ELEMENT.OL}
                          gap={GAP.NONE}
                          className="inbox-thread"
                          aria-label="Thread"
                        >
                          {thread.map((message, at) => (
                            <Fragment key={message.id}>
                              <ThreadMessage
                                item={item}
                                message={message}
                                thread={thread}
                                by={by}
                                now={now}
                                control={control}
                                waitingOn={waitingOn}
                              />
                              {/* The first message always stands, so the line saying earlier ones are cut follows it. */}
                              {at === 0 && thread.length >= INBOX_BOUNDS.MAX_MESSAGES_READ ? (
                                <EarlierMessages by={by} />
                              ) : null}
                            </Fragment>
                          ))}
                          {draftReply}
                        </Stack>
                      </AnswerMentions>
                    </>
                  )}
                </LoneLinkCards>
              </InboxPictures>
            </WordsWorkspace>
            {control.failed ? (
              <ErrorState onRetry={control.onRetry}>{INBOX_FAILED_LINE}</ErrorState>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        {open || next === undefined ? null : <InboxNextUp next={next} />}
      </Fill>
    </section>
  );
}
