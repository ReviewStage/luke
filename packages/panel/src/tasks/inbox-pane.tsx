import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import {
  fieldValueWords,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxBlock,
  type InboxChoice,
  type InboxField,
  type InboxForm,
  type InboxFormValue,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  type InboxReplyKind,
  inboxAnswerHeard,
  knownBlock,
  knownResponse,
} from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { CatalogModel } from "@luke/features/models-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BackIcon,
  Breadcrumbs,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHOICE_FLOW,
  CHOICE_LOOK,
  CHOICE_SELECT,
  CHOICE_TONE,
  Checkbox,
  ChoiceList,
  type ChoiceOption,
  type Crumb,
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  EllipsisIcon,
  ErrorState,
  type FieldControl,
  FoldingButton,
  type FoldingButtonHint,
  FormField,
  GAP,
  IconButton,
  ONE_LINE_END,
  SCROLL_FADE,
  ScrollArea,
  Stack,
  TEXT_FIELD_TYPE,
  TEXT_TONE,
  Text,
  TextField,
  useMenu,
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
import { CheckIcon, CircleSlashIcon, ClockIcon, FactoryIcon, Undo2Icon } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACTOR_SIZE, ActorLine, ActorMark, ActorRef, AutomationCard } from "../actor-ref.js";
import { useAutomation } from "../automation-directory.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { TextLink } from "../text-link.js";
import { Tooltip } from "../tooltip.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import {
  AgentActorRef,
  AgentCard,
  type AgentSubject,
  agentSubject,
  NOTHING_HELD,
} from "./agent-ref.js";
import { ArchivedComposerNote } from "./archived-task.js";
import { AttachedFileChips } from "./attached-file-chips.js";
import { InboxAnswerBox } from "./inbox-answer-box.js";
import { askHeadWords } from "./inbox-ask-words.js";
import { type InboxCloser, useInboxClose } from "./inbox-close.js";
import { InboxCodeCard, type InboxCodeDoors } from "./inbox-code-card.js";
import { type FormTextDoors, type FormTextProps, InboxFormText } from "./inbox-form-text.js";
import {
  ANSWER_TONE,
  type AnswerTone,
  answeredDraft,
  answerOf,
  archivedHolder,
  askNumberedPick,
  CLOSED_WORDS,
  decideButtons,
  decidedOf,
  decisionsOf,
  fieldValueOf,
  INBOX_HOLDER,
  INBOX_MISSING,
  type InboxDecided,
  type InboxDraft,
  type InboxHolder,
  type InboxKnownAsk,
  type InboxMissing,
  inboxCommentFiles,
  inboxFileChips,
  inboxThreadOf,
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
  shownTicks,
  THREAD_ENTRY,
  threadCut,
  threadEntries,
  withDecision,
  withStep,
  withValue,
} from "./inbox-model.js";
import { type InboxNext, InboxNextUp, type InboxPager, InboxPagerControls } from "./inbox-pager.js";
import { InboxPicture, InboxPictures } from "./inbox-pictures.js";
import { InboxStamp } from "./inbox-stamp.js";
import { LoneLinkCards } from "./lone-link-card.js";
import { RelativeTime } from "./relative-time.js";
import { REPLY_SCOPE } from "./reply-to-selection.js";
import { SentWords } from "./skill-chip.js";
import { TAB_KIND, tabLook } from "./tab-look.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { markReadItem } from "./task-menu-items.js";
import { useMinute } from "./task-time.js";
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
 * its title alone leads as the thread's subject. Each message under it is a comment, its
 * writer's face in a column of its own, a line of name and when beside it,
 * and a line down from the face joining it to the next. The agent's
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
 * keys being an option's own. The draft reply is the reader's face, "You"
 * and "draft", over the agent composer's box, its card and its field, with
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
 * item that needs the developer docked under the board, and the reader's
 * own message is scrolled into view inside the board as it lands, the
 * draft under it. A block or a response of a type
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
 * reply is no longer read; replaced, it says it was replaced by a newer question, or message, alone;
 * withdrawn, it says why, or who closed the item.
 *
 * Words selected in what the agent wrote, its question's Markdown, its
 * messages on the thread, and why it took the item back, stand Reply over
 * them, as an agent's words do in its tab (`reply-to-selection.tsx`): a
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

/** How long ago a thread's line says something happened: in the caption type, quieter still, in tabular figures, as a card's corner says it (`.thread-time`, tasks.css). */
const THREAD_TIME_CLASS = "thread-time";

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

/** The words a choice's open options are named by, for a reader that does not see the question over them. */
const CHOICE_LEGEND = "Options";

/** The badge an option the agent recommends wears, a choice's or a form's select's. */
const RECOMMENDED = "Recommended";

/** A choice's options as `@luke/ui`'s ChoiceList draws them, the one the agent recommends wearing its badge. */
export function choiceOptions(
  options: readonly { label: string; detail?: string | undefined; recommended: boolean }[],
): ChoiceOption<string>[] {
  return options.map((option) => ({
    value: option.label,
    label: option.label,
    detail: option.detail,
    badge: option.recommended ? RECOMMENDED : undefined,
  }));
}

/** Where a choice's open options stand, which a number key and Enter's way to what is missing find them by. */
const OPTIONS_ATTRIBUTE = "data-inbox-options";

/** The options of the open item's choice, in their order. */
function optionRows(pane: HTMLElement): HTMLButtonElement[] {
  return [
    ...pane.querySelectorAll<HTMLButtonElement>(
      `[${OPTIONS_ATTRIBUTE}] [role="radio"], [${OPTIONS_ATTRIBUTE}] [role="checkbox"]`,
    ),
  ];
}

/**
 * A choice's options, a radio list where it takes one and a checkbox list
 * where it takes several, each pressed to pick it and pressed again to let
 * it go. Where `numbered`, each of the first nine wears the number that
 * picks it, which the Inbox's pane answers (`useOptionNumbers`). Read-only,
 * it is the choice as it was answered, the picks checked, which no press,
 * key, or number reaches, and which Enter's way to an option passes by.
 */
export function ChoiceOptions({
  choice,
  draft,
  disabled,
  numbered = false,
  readOnly = false,
  onDraft,
}: {
  choice: Pick<InboxChoice, "options" | "multiple" | "recommended">;
  draft: InboxDraft;
  disabled: boolean;
  numbered?: boolean;
  readOnly?: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const options = choiceOptions(
    choice.options.map((option) => ({
      ...option,
      recommended: choice.recommended === option.label,
    })),
  );
  return (
    <div {...(readOnly ? {} : { [OPTIONS_ATTRIBUTE]: "" })}>
      <ChoiceList
        legend={CHOICE_LEGEND}
        options={options}
        value={draft.choices}
        select={choice.multiple === true ? CHOICE_SELECT.MANY : CHOICE_SELECT.ONE}
        look={CHOICE_LOOK.MARKED}
        numbered={numbered && !readOnly}
        clearable
        disabled={disabled}
        readOnly={readOnly}
        onChange={(choices) => onDraft({ ...draft, choices: [...choices] })}
      />
    </div>
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

/** What marks a field that may be left empty, since most must be filled. */
const OPTIONAL = "Optional";

/** A field's name, and "Optional" after it where it may be left empty. */
function FieldLabel({ field }: { field: InboxField }): React.JSX.Element {
  return (
    <>
      {field.label}
      {field.required === true ? null : <span className="inbox-field-optional">{OPTIONAL}</span>}
    </>
  );
}

/** How a form's text fields are drawn where the caller draws its own: the Inbox's composer field. */
export type FormText = (props: FormTextProps) => React.ReactNode;

/**
 * The parts of a field a frame's attributes name, which Enter's way to an
 * empty field finds it by; a field filled in as answered is named apart,
 * so that way never lands on one.
 */
function fieldFrame(field: InboxField, readOnly: boolean) {
  return readOnly
    ? ({ className: "inbox-field", "data-inbox-answered-field": field.type } as const)
    : ({
        className: "inbox-field",
        "data-inbox-field": field.type,
        "data-inbox-field-label": field.label,
      } as const);
}

/**
 * A text field's words as an answer gave them, in the field's own frame:
 * drawn as the agent's tab draws a sent message, so a mention they hold is
 * its chip, and empty where the field was left empty. Note that the
 * composer's editor is not loaded for it, since nothing is written here.
 */
function AnsweredText({
  control,
  words,
}: {
  control: FieldControl;
  words: string;
}): React.JSX.Element {
  return (
    <div className="inbox-field-composer" data-read-only="">
      {/* biome-ignore lint/a11y/useSemanticElements: the words hold mention chips, which no native field can, and speak as the read-only field they stand for. */}
      <div
        className="inbox-words inbox-field-words"
        role="textbox"
        aria-readonly="true"
        aria-multiline="true"
        aria-labelledby={control.labelId}
        aria-describedby={control["aria-describedby"]}
        tabIndex={-1}
      >
        {words === "" ? null : <SentWords text={words} />}
      </div>
    </div>
  );
}

/**
 * One field of a form, its name over its control and left-aligned as every
 * field is, "Optional" after the name of one that may be left empty: a
 * text field the caller's own or `@luke/ui`'s, a number a short field, a
 * select its options as pills that wrap, the one the agent recommends
 * wearing its badge, its pick taken back by pressing it again, since a
 * field left empty, required or not, is sent without it, and a yes or no a
 * checkbox beside its name. Read-only, each
 * control stands as the answer filled it, which nothing changes.
 */
function InboxFormField({
  field,
  draft,
  disabled,
  readOnly,
  text,
  onDraft,
}: {
  field: InboxField;
  draft: InboxDraft;
  disabled: boolean;
  readOnly: boolean;
  text: FormText | undefined;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const value = fieldValueOf(draft, field.label);
  const set = (next: string | number | boolean | undefined) =>
    onDraft(withValue(draft, field.label, next));
  switch (field.type) {
    case INBOX_FIELD.TEXT:
      return (
        <div {...fieldFrame(field, readOnly)}>
          <FormField label={<FieldLabel field={field} />}>
            {(control) => {
              const words = value === undefined ? "" : String(value);
              const onChange = (typed: string | undefined) =>
                set(typed === undefined || typed === "" ? undefined : typed);
              if (readOnly) return <AnsweredText control={control} words={words} />;
              return text === undefined ? (
                <TextField
                  field={control}
                  maxLength={INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS}
                  value={words}
                  disabled={disabled}
                  onChange={onChange}
                />
              ) : (
                text({ field, control, value: words, disabled, onChange })
              );
            }}
          </FormField>
        </div>
      );
    case INBOX_FIELD.NUMBER:
      return (
        <div {...fieldFrame(field, readOnly)}>
          <FormField label={<FieldLabel field={field} />}>
            {(control) => (
              <div className="inbox-field-short">
                <TextField
                  field={control}
                  type={TEXT_FIELD_TYPE.NUMBER}
                  maxLength={INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS}
                  value={value === undefined ? undefined : Number(value)}
                  disabled={disabled}
                  readOnly={readOnly}
                  onChange={set}
                />
              </div>
            )}
          </FormField>
        </div>
      );
    case INBOX_FIELD.SELECT:
      return (
        <div {...fieldFrame(field, readOnly)}>
          <span className="inbox-field-name" aria-hidden="true">
            <FieldLabel field={field} />
          </span>
          <ChoiceList
            legend={field.label}
            options={(field.options ?? []).map((option) => ({
              value: option,
              label: option,
              badge: field.recommended === option ? RECOMMENDED : undefined,
            }))}
            value={(field.options ?? []).filter((option) => option === value)}
            look={CHOICE_LOOK.PILL}
            clearable
            disabled={disabled}
            readOnly={readOnly}
            onChange={(picked) => set(picked[0])}
          />
        </div>
      );
    case INBOX_FIELD.BOOLEAN:
      return (
        <div {...fieldFrame(field, readOnly)}>
          <Checkbox checked={value === true} disabled={disabled} readOnly={readOnly} onChange={set}>
            <FieldLabel field={field} />
          </Checkbox>
        </div>
      );
  }
}

/** A form's fields, stacked in the agent's order; its text fields drawn by `text` where it is given; read-only, as an answer filled them. */
export function FormFields({
  form,
  draft,
  disabled,
  readOnly = false,
  text,
  onDraft,
}: {
  form: Pick<InboxForm, "fields">;
  draft: InboxDraft;
  disabled: boolean;
  readOnly?: boolean;
  text?: FormText | undefined;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      {form.fields.map((field) => (
        <InboxFormField
          key={field.label}
          field={field}
          draft={draft}
          disabled={disabled}
          readOnly={readOnly}
          text={text}
          onDraft={onDraft}
        />
      ))}
    </Stack>
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

/** Answers no change, for the controls of an answer already given. */
function heldStill(): void {}

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

/** What an editor's own element matches, its words written in place, and a field of several lines. */
const WRITES_LINES = 'textarea, [contenteditable]:not([contenteditable="false"])';

/** Whether a key goes to whatever takes typing: a field, a select, or an editor. */
function takesTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches(`input, select, ${WRITES_LINES}`);
}

/** Whether a key goes to something written in lines, whose own Enter breaks one: an editor or a field of several lines. */
function writesLines(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches(WRITES_LINES);
}

/** Whether a key comes alone, with no modifier but perhaps Shift. */
function bareKey(event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey;
}

/**
 * Sends the open item's answer from wherever in its pane the developer
 * pressed Enter, through its box's own send, so the box's checks stand: an
 * answer complete goes, and one that is not takes the keyboard to what it
 * lacks (`InboxAnswerBox`).
 */
function sendFromPane(pane: HTMLElement | null): void {
  pane?.querySelector<HTMLFormElement>("form.inbox-answer")?.requestSubmit();
}

/**
 * Enter in an open item's question, on an option or in a form's field,
 * sends the answer, and never presses the option it stands on; Shift+Enter
 * is no send, and an editor's Enter is the editor's own to hand on.
 */
function onResponseKey(
  pane: React.RefObject<HTMLElement | null>,
  event: React.KeyboardEvent,
): void {
  // Note that the key is held back here, as it bubbles, which keeps a focused option's button from pressing it.
  if (event.key !== "Enter" || event.shiftKey || !bareKey(event) || event.nativeEvent.isComposing) {
    return;
  }
  if (writesLines(event.target)) return;
  event.preventDefault();
  sendFromPane(pane.current);
}

/**
 * Takes the keyboard to what the answer lacks: the option a reader's Tab
 * lands on, the field's first control, or the box's words.
 */
function focusMissing(pane: HTMLElement | null, missing: InboxMissing): void {
  if (pane === null) return;
  if (missing.kind === INBOX_MISSING.OPTION) {
    const rows = optionRows(pane);
    (rows.find((row) => row.tabIndex === 0) ?? rows[0])?.focus();
    return;
  }
  if (missing.kind === INBOX_MISSING.WORDS) {
    // Note that the note's field is the one outside the question's own, whose text fields stand over it in the box.
    [...pane.querySelectorAll<HTMLElement>('.inbox-answer [contenteditable="true"]')]
      .find((editor) => editor.closest(".inbox-draft-ask") === null)
      ?.focus();
    return;
  }
  const field = [...pane.querySelectorAll<HTMLElement>("[data-inbox-field]")].find(
    (each) => each.dataset.inboxFieldLabel === missing.label,
  );
  field
    ?.querySelector<HTMLElement>(
      'input, [contenteditable="true"], button:not([tabindex="-1"]):not(:disabled)',
    )
    ?.focus();
}

/** The responses whose options a number key picks: a choice's, and an approval's or a to-do's two. */
const NUMBERED_RESPONSES: ReadonlySet<string> = new Set([
  INBOX_RESPONSE.CHOICE,
  INBOX_RESPONSE.APPROVAL,
  INBOX_RESPONSE.TODO,
]);

/** The keys 1 to 9, each the option of its number. */
const OPTION_NUMBER = /^[1-9]$/u;

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
function AgentName({
  by,
  nameOnly = false,
}: {
  by: ItemAgent;
  /** Whether the name stands without its tile, as a comment's writer does beside their face. */
  nameOnly?: boolean;
}): React.JSX.Element {
  return (
    <AgentActorRef subject={by.subject} models={by.models} onOpen={by.onOpen} nameOnly={nameOnly} />
  );
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

/** Which message of the thread a comment is: the agent's question, the developer's answer, the agent taking the item back, a member closing it without an answer, a message on the thread, or the reader's draft reply at its end. */
const COMMENT = {
  ASKED: "asked",
  ANSWERED: "answered",
  WITHDRAWN: "withdrawn",
  CLOSED: "closed",
  MESSAGE: "message",
  DRAFT: "draft",
} as const;

type CommentKind = (typeof COMMENT)[keyof typeof COMMENT];

/**
 * One message of the thread as a comment: its writer's face in a column of
 * its own, then a line of who and when, and what they wrote under it, a
 * line down from the face joining it to the next. The writer is named
 * once, by name alone, since the face already stands beside it.
 */
function Comment({
  kind,
  face,
  head,
  messageId,
  children,
}: {
  kind: CommentKind;
  face: Actor;
  head: React.ReactNode;
  /** The message a thread's message comment draws, which a send scrolls to. */
  messageId?: string | undefined;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className="inbox-comment" data-inbox-comment={kind} data-message-id={messageId}>
      <span className="inbox-comment-face">
        <ActorMark actor={face} size={ACTOR_SIZE.ROW} />
      </span>
      <div className="inbox-comment-main">
        <div className="inbox-comment-head">{head}</div>
        {children === undefined ? null : <div className="inbox-comment-body">{children}</div>}
      </div>
    </li>
  );
}

/** A comment's writer by name, which hangs their card and opens their page or tab. */
function CommentName({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="inbox-comment-name">{children}</span>;
}

/** What the draft reply's head says: the reader, and that it is not sent yet. */
const DRAFT_HEAD = {
  YOU: "You",
  DRAFT: "draft",
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
 * a member's is: their face, "You" and "draft" in its head, and the box
 * under it, so what is sent drops into the thread in its place and the
 * box stands at the end again, as an issue's thread is written on.
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
      face={reader}
      head={
        <>
          <CommentName>{DRAFT_HEAD.YOU}</CommentName>
          <span className="inbox-comment-when">{DRAFT_HEAD.DRAFT}</span>
        </>
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
 * drawn after its words, never as a strip over them. A picture its words
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
    <ul className="inbox-values" data-inbox-values="">
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
    </ul>
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
      face={answerer}
      head={
        <>
          <CommentName>
            <ActorRef actor={answerer} nameOnly />
          </CommentName>
          <span className="inbox-comment-when">
            <RelativeTime
              className={THREAD_TIME_CLASS}
              at={settledAt(item) ?? item.updatedAt}
              now={now}
            />{" "}
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
      {/* The note is drawn as the agent's tab draws a message, so a mention it holds is its chip. */}
      {settled.note === undefined ? null : (
        <div className="inbox-words" data-inbox-note="">
          <SentWords text={settled.note} asDocument />
        </div>
      )}
      <CommentFiles
        itemId={item.id}
        files={item.answerFiles ?? NO_FILES}
        words={settled.note}
        images={images}
        onImage={onImage}
        onRetryImage={onRetryImage}
      />
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
      face={by.subject.tile}
      head={
        <>
          <CommentName>
            <AgentName by={by} nameOnly />
          </CommentName>
          <span className="inbox-comment-when">
            withdrew this{" "}
            <RelativeTime
              className={THREAD_TIME_CLASS}
              at={settledAt(item) ?? item.updatedAt}
              now={now}
            />
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
      face={closer}
      head={
        <>
          <CommentName>
            <ActorRef actor={closer} nameOnly />
          </CommentName>
          <span className="inbox-comment-when">
            <RelativeTime
              className={THREAD_TIME_CLASS}
              at={settledAt(item) ?? item.updatedAt}
              now={now}
            />{" "}
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
      face={fromAgent ? by.subject.tile : member}
      messageId={message.id}
      head={
        <>
          <CommentName>
            {fromAgent ? <AgentName by={by} nameOnly /> : <ActorRef actor={member} nameOnly />}
          </CommentName>
          <span className="inbox-comment-when">
            <RelativeTime className={THREAD_TIME_CLASS} at={message.createdAt} now={now} />
          </span>
        </>
      }
    >
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
      <CommentFiles
        itemId={item.id}
        files={message.files ?? NO_FILES}
        words={message.text}
        images={images}
        onImage={onImage}
        onRetryImage={onRetryImage}
      />
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
 * or another item opened, scrolls nothing.
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

/** Scrolls `scroller` so `reply` stands just over its foot, the end of the thread, or its top in view where it is taller than the room. */
function standOverFoot(scroller: HTMLElement, reply: Element): void {
  const room = scroller.getBoundingClientRect();
  const box = reply.getBoundingClientRect();
  const under = box.bottom - (room.bottom - footPadding(scroller));
  if (under !== 0) scroller.scrollTop += Math.min(under, box.top - room.top);
}

/** The reader's own ways of moving a thread, after any of which the pane leaves where it stands to them. */
const READER_MOVES = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Opens each item at its thread's top, rather than where the last item was
 * scrolled, as the pane stands for every item in turn; but an item whose
 * question waits on an answer opens at the thread's end instead, on the
 * draft reply that holds the question's controls, standing just over the
 * board's foot, where they would otherwise wait out of sight. While what
 * stands above it still lands, a picture read late, it is stood there
 * again, until the reader moves the thread themselves.
 */
function useOpenOnAsk(board: React.RefObject<HTMLDivElement | null>, itemId: string): void {
  useLayoutEffect(() => {
    const scroller = board.current;
    if (scroller === null) return undefined;
    scroller.scrollTop = 0;
    if (scroller.querySelector("[data-inbox-draft-ask]") === null) return undefined;
    const stand = () => {
      const reply = draftReplyOf(scroller);
      if (reply !== null) standOverFoot(scroller, reply);
    };
    stand();
    const content = scroller.querySelector(".inbox-board");
    const observer = new ResizeObserver(stand);
    if (content !== null) observer.observe(content);
    const letGo = () => {
      observer.disconnect();
      for (const move of READER_MOVES) scroller.removeEventListener(move, letGo);
    };
    for (const move of READER_MOVES) scroller.addEventListener(move, letGo, { passive: true });
    return letGo;
  }, [board, itemId]);
}

/** What an ask's box says where its type is one this build does not know. */
const NEWER_LUKE_ASK = "Answer this in a newer Luke.";

/** What a thread's line says while its ask waits on the reader's answer. */
const WAITING_ON_YOU = "Waiting on you";

/**
 * Who an open ask waits on, as the list says it: the reader, in the
 * attention ink, where the item is theirs (`readersItem`), or the teammate
 * who started its agent, in the muted ink, as the list's Waiting on others
 * does, though any member may still answer.
 */
function Waiting({ on }: { on: InboxItem["startedBy"] }): React.JSX.Element {
  const starter = usePerson(on);
  if (on === undefined) {
    return (
      <span className="inbox-waiting" data-inbox-waiting="">
        {WAITING_ON_YOU}
      </span>
    );
  }
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

/** What an ask's box says of an ask settled where the thread read no longer carries its answer. */
const ANSWERED = "Answered";

/** What an ask's box says of one its agent took back, before why. */
const WITHDRAWN = "Withdrawn";

/** What the presses closing an open ask say. */
const ASK_PRESS = {
  DONE: "Mark done",
  NOT_DONE: "Couldn't do it",
  ANSWER: "Answer",
} as const;

/** What an open ask's presses send, and what they are drawn with. */
interface AskDoors {
  readonly draft: InboxDraft;
  readonly disabled: boolean;
  readonly text: FormTextDoors;
  readonly onDraft: (draft: InboxDraft) => void;
}

/** A press closing an open ask, which attaches its answer to the reply while pressed, and takes it off pressed again. */
function AskPress({
  label,
  variant = BUTTON_VARIANT.OUTLINE,
  pressed,
  disabled,
  onPress,
}: {
  label: string;
  variant?: typeof BUTTON_VARIANT.OUTLINE | typeof BUTTON_VARIANT.QUIET;
  pressed: boolean;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Button
      variant={variant}
      size={BUTTON_SIZE.COMPACT}
      pressed={pressed}
      disabled={disabled}
      onClick={onPress}
    >
      {label}
    </Button>
  );
}

/**
 * An open ask's controls, each attaching its answer to the reply rather
 * than sending it, and each press taking it off again: a `decide`'s options
 * numbered for the keys, or its two small buttons where it is a yes or no
 * in other words; a `do`'s steps as
 * checkboxes, then Mark done, which ticks every one, and Couldn't do it;
 * an `answer`'s fields, whose values attach to the reply as they are
 * filled, with no press, a form filled in part sending what was filled, or
 * its Answer, whose reply's words are the answer.
 */
function AskControls({
  ask,
  title,
  doors,
}: {
  ask: InboxKnownAsk;
  /** The item's title, which stands as the one step of a to-do that names none. */
  title: string;
  doors: AskDoors;
}): React.JSX.Element {
  const { draft, disabled, onDraft } = doors;
  const press = (reply: InboxReplyKind) =>
    onDraft({ ...draft, press: draft.press === reply ? undefined : reply });
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return decideButtons(ask) ? (
        <div className="inbox-ask-presses" data-inbox-options="">
          {ask.options.map((option) => {
            const picked = draft.choices.includes(option.label);
            return (
              <AskPress
                key={option.label}
                label={option.label}
                pressed={picked}
                disabled={disabled}
                onPress={() => onDraft({ ...draft, choices: picked ? [] : [option.label] })}
              />
            );
          })}
        </div>
      ) : (
        <div className="inbox-ask-options">
          <ChoiceOptions
            choice={ask}
            draft={draft}
            disabled={disabled}
            numbered
            onDraft={onDraft}
          />
        </div>
      );
    case INBOX_ASK.DO: {
      const steps = ask.steps.length === 0 ? [title] : ask.steps;
      const ticked = new Set(shownTicks(ask, draft));
      return (
        <>
          <ul className="inbox-ask-steps" aria-label="Steps">
            {steps.map((step, at) => (
              // Steps have no key of their own, and are never reordered.
              <li key={at} data-inbox-step="">
                <Checkbox
                  checked={ticked.has(at)}
                  disabled={disabled}
                  onChange={() => onDraft(withStep(ask, draft, at))}
                >
                  {step}
                </Checkbox>
              </li>
            ))}
          </ul>
          <div className="inbox-ask-presses">
            <AskPress
              label={ASK_PRESS.DONE}
              pressed={draft.press === INBOX_REPLY.DONE}
              disabled={disabled}
              onPress={() => press(INBOX_REPLY.DONE)}
            />
            <AskPress
              label={ASK_PRESS.NOT_DONE}
              variant={BUTTON_VARIANT.QUIET}
              pressed={draft.press === INBOX_REPLY.NOT_DONE}
              disabled={disabled}
              onPress={() => press(INBOX_REPLY.NOT_DONE)}
            />
          </div>
        </>
      );
    }
    case INBOX_ASK.ANSWER:
      return ask.fields === undefined ? (
        <div className="inbox-ask-presses">
          <AskPress
            label={ASK_PRESS.ANSWER}
            pressed={draft.press === INBOX_REPLY.ANSWERED}
            disabled={disabled}
            onPress={() => press(INBOX_REPLY.ANSWERED)}
          />
        </div>
      ) : (
        <div className="inbox-ask-fields">
          <FormFields
            form={{ fields: ask.fields }}
            draft={draft}
            disabled={disabled}
            text={(props) => <InboxFormText {...props} doors={doors.text} />}
            onDraft={onDraft}
          />
        </div>
      );
  }
}

/** The glyph a press given wears: a check in green going ahead, a turn back in red holding back. */
function ToneGlyph({ tone }: { tone: AnswerTone }): React.JSX.Element {
  return (
    <span className="inbox-ask-pressed" data-tone={tone}>
      {tone === ANSWER_TONE.AHEAD ? (
        <CheckIcon aria-hidden="true" />
      ) : (
        <Undo2Icon aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * A press of an answered ask as it was left: its look and words as it was
 * offered, the one given pressed and wearing its glyph, none of them
 * taking a press.
 */
function AnsweredPress({
  label,
  variant = BUTTON_VARIANT.OUTLINE,
  tone,
  pressed,
}: {
  label: string;
  variant?: typeof BUTTON_VARIANT.OUTLINE | typeof BUTTON_VARIANT.QUIET;
  tone: AnswerTone;
  pressed: boolean;
}): React.JSX.Element {
  return (
    <Button
      variant={variant}
      size={BUTTON_SIZE.COMPACT}
      pressed={pressed}
      readOnly
      icon={pressed ? <ToneGlyph tone={tone} /> : undefined}
    >
      {label}
    </Button>
  );
}

/**
 * The ask a member's reply answered, at the head of that reply under their
 * face and name, in the reply's stamp's place: the ask's controls alone,
 * standing in the reply with no card around them, as the answer left them, in the look they had
 * while it waited and taking nothing, which say how it was answered: a
 * `decide`'s options with the picks checked, or its two small buttons with
 * the one pressed marked; a `do`'s steps ticked as they were sent, over
 * Mark done and Couldn't do it with the one pressed marked; an `answer`'s
 * fields, each holding what it was given, empty where it was left empty.
 * An `answer` of no fields draws no card, its reply's words being the
 * answer and the agent's message saying it was answered (`AskBox`).
 */
function AnsweredCard({
  ask,
  title,
  answers,
}: {
  ask: InboxKnownAsk;
  /** The item's title, which stands as the one step of a to-do that names none. */
  title: string;
  answers: InboxAnswers;
}): React.JSX.Element | null {
  const draft = answeredDraft(ask, answers);
  const body = (controls: React.ReactNode) => (
    // Note that it is no `inbox-ask` card: the controls stand in the reply itself, at its words' left edge.
    <div className="inbox-ask-answered" data-inbox-answered="">
      {controls}
    </div>
  );
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return body(
        decideButtons(ask) ? (
          <div className="inbox-ask-presses">
            {ask.options.map((option, at) => (
              <AnsweredPress
                key={option.label}
                label={option.label}
                tone={at === 0 ? ANSWER_TONE.AHEAD : ANSWER_TONE.BACK}
                pressed={draft.choices.includes(option.label)}
              />
            ))}
          </div>
        ) : (
          <ChoiceOptions choice={ask} draft={draft} disabled={false} readOnly onDraft={heldStill} />
        ),
      );
    case INBOX_ASK.DO: {
      const steps = ask.steps.length === 0 ? [title] : ask.steps;
      const ticked = new Set(draft.steps ?? []);
      return body(
        <>
          <ul className="inbox-ask-steps" aria-label="Steps">
            {steps.map((step, at) => (
              // Steps have no key of their own, and are never reordered.
              <li key={at} data-inbox-step="">
                <Checkbox checked={ticked.has(at)} readOnly onChange={heldStill}>
                  {step}
                </Checkbox>
              </li>
            ))}
          </ul>
          <div className="inbox-ask-presses">
            <AnsweredPress
              label={ASK_PRESS.DONE}
              tone={ANSWER_TONE.AHEAD}
              pressed={answers.reply === INBOX_REPLY.DONE}
            />
            <AnsweredPress
              label={ASK_PRESS.NOT_DONE}
              variant={BUTTON_VARIANT.QUIET}
              tone={ANSWER_TONE.BACK}
              pressed={answers.reply === INBOX_REPLY.NOT_DONE}
            />
          </div>
        </>,
      );
    }
    case INBOX_ASK.ANSWER:
      return ask.fields === undefined
        ? null
        : body(
            <FormFields
              form={{ fields: ask.fields }}
              draft={draft}
              disabled={false}
              readOnly
              onDraft={heldStill}
            />,
          );
  }
}

/**
 * What ends an agent's message whose ask of words alone was answered, where
 * the thread read carries the reply: a small pill saying "Answered", with
 * no card, the reply's words being the answer.
 */
function AnsweredMarker(): React.JSX.Element {
  return (
    <span className="inbox-ask-settled" data-inbox-settled="answered">
      <CheckIcon aria-hidden="true" />
      {ANSWERED}
    </span>
  );
}

/**
 * What ends an agent's message whose ask was replaced: the same small
 * pill, in the muted ink alone, saying what replaced it, a newer question
 * where a later message of the agent's on the thread asks one and a newer
 * message otherwise, with no card.
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
    <span className="inbox-ask-settled" data-inbox-settled="replaced">
      {asked ? REPLACED.BY_QUESTION : REPLACED.BY_MESSAGE}
    </span>
  );
}

/** How a withdrawn ask's line reads: why its agent took it back, or who closed the item without answering, while the close stands. */
function WithdrawnLine({
  item,
  reason,
}: {
  item: InboxItem;
  reason: string | undefined;
}): React.JSX.Element {
  const closer = usePerson(item.closedBy);
  if (reason !== undefined) {
    return (
      <span className="inbox-ask-standing">
        {WITHDRAWN}: {reason}
      </span>
    );
  }
  return (
    <span className="inbox-ask-standing">
      <CircleSlashIcon aria-hidden="true" />
      {item.closedBy === undefined ? (
        CLOSED_WORDS
      ) : (
        <ActorLine>
          <ActorRef actor={closer} nameOnly />
          {` · ${CLOSED_WORDS}`}
        </ActorLine>
      )}
    </span>
  );
}

/**
 * The small pill that ends the agent's message while what it asks waits:
 * whom it waits on, "Waiting on you", after a dot in the attention ink
 * where it waits on the reader and the muted ink where it waits on a
 * teammate. Its controls stand in the reader's draft reply at the
 * thread's end (`DraftReply`), not here.
 */
function AskMarker({ on }: { on: InboxItem["startedBy"] }): React.JSX.Element {
  const starter = usePerson(on);
  const waiting =
    on === undefined ? WAITING_ON_YOU : `Waiting on ${actorName(starter, { sentence: true })}`;
  return (
    <span
      className="inbox-ask-marker"
      data-inbox-marker=""
      data-inbox-waiting={on === undefined ? "you" : "teammate"}
    >
      {waiting}
    </span>
  );
}

/**
 * The box closing a message that asks: while it waits, a marker alone
 * saying whom it waits on (`AskMarker`), its controls standing in
 * the draft reply; once answered, nothing, the card standing at the head
 * of the reply that answered it (`AnsweredCard`), or, for an ask of words
 * alone, which draws no card, a small "Answered" marker (`AnsweredMarker`);
 * a card saying
 * "Answered" alone where the thread read no longer carries that reply; for
 * a replaced ask, no card, a small marker saying a newer question, or
 * message, replaced it (`ReplacedMarker`); a withdrawn one's card with
 * why, or who closed the item; and an ask this build does not know a card
 * naming a newer Luke.
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
        <div className="inbox-ask-head">
          <Text tone={TEXT_TONE.MUTED}>{NEWER_LUKE_ASK}</Text>
          {ask.status === INBOX_ASK_STATUS.OPEN ? <Waiting on={waitingOn} /> : null}
        </div>
      </div>
    );
  }
  if (ask.status === INBOX_ASK_STATUS.REPLACED) {
    return <ReplacedMarker message={message} thread={thread} />;
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
  const standing = (() => {
    switch (ask.status) {
      case INBOX_ASK_STATUS.ANSWERED:
        return <span className="inbox-ask-standing">{ANSWERED}</span>;
      case INBOX_ASK_STATUS.WITHDRAWN:
        return <WithdrawnLine item={item} reason={ask.withdrawnReason} />;
    }
  })();
  return (
    <div className="inbox-ask" data-inbox-ask={ask.status}>
      <div className="inbox-ask-head">
        <span className="inbox-ask-kind">{askHeadWords(ask, undefined)}</span>
        {standing}
      </div>
    </div>
  );
}

/**
 * The open question's controls at the top of the draft reply's card, over
 * the note, with no head of their own, since the agent's message says what
 * it asks: an Enter on an option or in a field sends the card. Where the
 * item is put away with its task, they stand in the agent's message
 * instead, as a card of their own whose controls take nothing.
 */
function DraftQuestion({
  held,
  pane,
  children,
}: {
  /** Whether it stands in the agent's message as a card of its own, taking nothing, its item put away with its task. */
  held: boolean;
  pane: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys it hears come from the options and fields inside it, whose Enter sends the card.
    <div
      className="inbox-draft-ask"
      data-inbox-draft-ask={held ? undefined : ""}
      data-held={held ? "" : undefined}
      onKeyDown={(event) => onResponseKey(pane, event)}
    >
      {children}
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
  held,
}: {
  item: InboxItem;
  message: InboxMessage;
  thread: readonly InboxMessage[];
  by: ItemAgent;
  now: number;
  control: TaskInboxControl;
  waitingOn: InboxItem["startedBy"];
  /** The open ask's controls, taking nothing, where the item is put away with its task and no draft stands to hold them. */
  held: React.ReactNode;
}): React.JSX.Element {
  const member = usePerson(message.member);
  const fromAgent = message.author === INBOX_MESSAGE_AUTHOR.AGENT;
  const answers = message.answers;
  const answered = answers === undefined ? undefined : answeredAsk(thread, answers);
  return (
    <Comment
      kind={COMMENT.MESSAGE}
      face={fromAgent ? by.subject.tile : member}
      messageId={message.id}
      head={
        <>
          <CommentName>
            {fromAgent ? <AgentName by={by} nameOnly /> : <ActorRef actor={member} nameOnly />}
          </CommentName>
          <span className="inbox-comment-when">
            <RelativeTime className={THREAD_TIME_CLASS} at={message.createdAt} now={now} />
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
      <CommentFiles
        itemId={item.id}
        files={message.files ?? NO_FILES}
        words={message.text}
        images={control.images}
        onImage={control.onImage}
        onRetryImage={control.onRetryImage}
      />
      {message.ask === undefined ? null : (
        <AskBox
          item={item}
          message={message}
          ask={message.ask}
          thread={thread}
          waitingOn={waitingOn}
        />
      )}
      {held}
    </Comment>
  );
}

/** What the pane's ⋯ menu is called, which is its tooltip too. */
const ITEM_MENU_LABEL = "Item actions";

/**
 * The item's ⋯ menu at the end of the pane's bar, as an issue's page and an
 * agent's tab end theirs: Mark as read or unread, naming U, as the item's
 * row's menu does; Copy link, the item's link under its task or its agent; and, while the item is open on a task that is not archived, Close
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
  const close = useInboxClose(item, archivedHolder(holder) ? undefined : onClose, shown);
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

/** What stands in the box's place while the item's task is archived. */
const ARCHIVED_ITEM_NOTE = "Unarchive the task to answer or reply";

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
  /** Brings the item's task back from the archive, offered where the box would stand while it is archived; none where the task is not archived. */
  readonly onUnarchive?: (() => void) | undefined;
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
    // Note that the agents no automation names stand under no automation, so their crumb wears the Factory's glyph, where every agent is listed, as their group's header does.
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
          glyph: tabLook({ kind: TAB_KIND.PLAN, name: holder.task.name }).icon,
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
    },
    { label: title, current: true, shown: titleShown, end: ONE_LINE_END.ELLIPSIS },
  ].filter((crumb) => crumb !== undefined);
  return (
    <div className="inbox-crumbs">
      <Breadcrumbs label="Path" crumbs={crumbs} hint={Tooltip} />
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
  useOpenOnAsk(board, item.id);
  const directory = useMemberDirectory();
  const readerId = directory.readerId ?? agents.me;
  useScrollToOwnMessage(board, item, readerId);
  const [heading, setHeading] = useState<HTMLElement | null>(null);
  const headingAway = useHeadingAway(board, heading, item.id);
  // An open ask waits on whoever started its agent, as the list says, though any member may answer it.
  const waitingOn = readersItem(item, readerId) ? undefined : item.startedBy;
  const by: ItemAgent = {
    subject: agentSubject(agents, item.agentId, NOTHING_HELD, false),
    models: agents.models,
    onOpen: () => doors.onOpenAgent(item.agentId),
  };
  const open = item.status === INBOX_STATUS.OPEN;
  // An item put away with its task is read but not answered, nor written on, until the task is back.
  const archived = archivedHolder(holder);
  const answerable = open && !archived;
  const draft = control.draftOf(item);
  // Note that an item from version 5 is drawn as its thread, and one from before as it always was.
  const thread = inboxThreadOf(item);
  useOptionNumbers(
    pane,
    item,
    draft,
    control,
    answerable ? numberedPickOf(item, thread) : undefined,
  );
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
  // Note that a note asks nothing back but a nod, so it waits on no one's answer and wears no marker.
  const marked = knownResponse(item.response) && item.response.type !== INBOX_RESPONSE.NONE;
  // Note that an item put away with its task draws its question in the agent's message instead, taking nothing, since no draft stands to hold it.
  const question =
    thread === undefined ? (
      open && drawsControls(item) ? (
        <DraftQuestion held={archived} pane={pane}>
          <ResponseControls
            item={item}
            draft={draft}
            disabled={!answerable}
            text={formText}
            onDraft={onDraft}
          />
        </DraftQuestion>
      ) : undefined
    ) : openAsk === undefined ? undefined : (
      <DraftQuestion held={archived} pane={pane}>
        <AskControls
          ask={openAsk}
          title={cardTitle(item.title)}
          doors={{ draft, disabled: !answerable, text: formText, onDraft }}
        />
      </DraftQuestion>
    );
  // The box stands at the thread's end as the reader's draft reply, unless the item is put away with its task.
  const draftReply = archived ? null : (
    <AnswerMentions value={mentions}>
      <DraftReply readerId={readerId}>
        <InboxAnswerBox
          item={item}
          readerId={readerId}
          control={control}
          agent={by.subject.agent}
          agentName={by.subject.name}
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
      <div className="desktop-inbox">
        {/* The box docks under the thread as an agent's composer does under its log, which runs up to the card and fades there. */}
        <ScrollArea fade={SCROLL_FADE.BOTH} data-item-id={item.id} ref={board}>
          <div className="inbox-board agent-log-over-composer ph-no-capture">
            <WordsWorkspace value={workspaceId}>
              {/* The item's words are drawn as documents: its own pictures read through the Inbox, and a link alone on its line as its card. */}
              <InboxPictures itemId={item.id} control={control}>
                <LoneLinkCards doors={cardDoors}>
                  {thread === undefined ? (
                    <>
                      <Subject item={item} heading={setHeading} />
                      <ol className="inbox-thread" aria-label="Thread">
                        <Comment
                          kind={COMMENT.ASKED}
                          face={by.subject.tile}
                          head={
                            <>
                              <CommentName>
                                <AgentName by={by} nameOnly />
                              </CommentName>
                              <span className="inbox-comment-when">
                                <RelativeTime
                                  className={THREAD_TIME_CLASS}
                                  at={item.postedAt}
                                  now={now}
                                />
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
                          {archived ? question : null}
                        </Comment>
                        <ThreadAfter item={item} by={by} now={now} control={control} />
                        {draftReply}
                      </ol>
                    </>
                  ) : (
                    <>
                      <Subject item={item} heading={setHeading} />
                      <AnswerMentions value={mentions}>
                        <ol className="inbox-thread" aria-label="Thread">
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
                                held={
                                  archived && asking?.message.id === message.id
                                    ? question
                                    : undefined
                                }
                              />
                              {/* The first message always stands, so the line saying earlier ones are cut follows it. */}
                              {at === 0 && thread.length >= INBOX_BOUNDS.MAX_MESSAGES_READ ? (
                                <EarlierMessages by={by} />
                              ) : null}
                            </Fragment>
                          ))}
                          {draftReply}
                        </ol>
                      </AnswerMentions>
                    </>
                  )}
                </LoneLinkCards>
              </InboxPictures>
            </WordsWorkspace>
            {control.failed ? (
              <ErrorState onRetry={control.onRetry}>{INBOX_FAILED_LINE}</ErrorState>
            ) : null}
          </div>
        </ScrollArea>
        {open || archived || next === undefined ? null : <InboxNextUp next={next} />}
        {archived && doors.onUnarchive !== undefined ? (
          <ArchivedComposerNote onUnarchive={doors.onUnarchive} words={ARCHIVED_ITEM_NOTE} />
        ) : null}
      </div>
    </section>
  );
}
